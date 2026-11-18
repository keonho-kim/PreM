// Purpose: Supervise bundled document tools and validate their runtime fingerprint.
// Pattern: Owned temporary workspaces, offline Node permissions, bounded output and cancellation.
// Usage: App constructs Runtime once and injects its document/template adapters.
// Related: documents.rs, templates.rs, backend/tools/, runtime/document-manifest.json.
mod documents;
mod html;
mod ocr_cache;
mod packages;
mod pptx;
mod presentation_assembly;
mod presentation_canvas;
mod presentation_inputs;
mod presentation_layers;
mod presentation_media;
mod presentations;
mod reference_pptx;
mod supervision;
mod templates;
use crate::modules::{assets::AssetService, documents::Error};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;
#[derive(Deserialize)]
struct Manifest {
    platform: String,
    arch: String,
    node_version: String,
    python_version: String,
    node: PathBuf,
    python: PathBuf,
    files: std::collections::BTreeMap<String, String>,
}
#[derive(Clone)]
pub(crate) struct Runtime {
    root: PathBuf,
    work: PathBuf,
    cache: PathBuf,
    manifest: Option<Arc<Manifest>>,
    profile: String,
    assets: AssetService,
    imports: crate::modules::ppt_imports::Imports,
    import_gate: Arc<tokio::sync::Mutex<()>>,
    media_gate: Arc<tokio::sync::Semaphore>,
}
impl Runtime {
    pub fn open(
        data: &Path,
        assets: AssetService,
        imports: crate::modules::ppt_imports::Imports,
    ) -> anyhow::Result<Self> {
        let root = std::env::var_os("APP_DOCUMENT_RUNTIME_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let adjacent = std::env::current_exe()
                    .unwrap_or_default()
                    .parent()
                    .unwrap_or(Path::new("."))
                    .join("runtime");
                if adjacent.join("document-manifest.json").exists() {
                    adjacent
                } else {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime")
                }
            });
        let root = root.canonicalize()?;
        let work = data.join("work");
        for entry in std::fs::read_dir(&work)? {
            let e = entry?;
            if e.file_name()
                .to_string_lossy()
                .starts_with(".prem-process-")
            {
                anyhow::ensure!(
                    e.file_type()?.is_dir(),
                    "unexpected processing workspace entry"
                );
                std::fs::remove_dir_all(e.path())?;
            }
        }
        let loaded = std::fs::read(root.join("document-manifest.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok());
        let mut hash = Sha256::new();
        hash.update(b"PuPuTyX-extraction-v2-normalized-packages");
        let manifest = loaded.filter(|m| {
            hash.update(m.platform.as_bytes());
            hash.update(m.arch.as_bytes());
            hash.update(m.node_version.as_bytes());
            hash.update(m.python_version.as_bytes());
            m.files.iter().all(|(name, expected)| {
                if Path::new(name).is_absolute()
                    || Path::new(name)
                        .components()
                        .any(|p| matches!(p, std::path::Component::ParentDir))
                {
                    return false;
                }
                match std::fs::read(root.join(name)) {
                    Ok(bytes) => {
                        let actual = hex::encode(Sha256::digest(&bytes));
                        hash.update(name.as_bytes());
                        hash.update(actual.as_bytes());
                        &actual == expected
                    }
                    Err(_) => false,
                }
            })
        });
        let manifest = manifest.map(|mut m| {
            if m.node.is_relative() {
                m.node = root.join(&m.node);
            }
            if m.python.is_relative() {
                m.python = root.join(&m.python);
            }
            m
        });
        let profile = if manifest.is_some() {
            hex::encode(hash.finalize())
        } else {
            "runtime-unavailable-v1".into()
        };
        let cache = if manifest.is_some() {
            ocr_cache::prepare(data, &root)?
        } else {
            data.join("config/kordoc-cache")
        };
        Ok(Self {
            cache,
            root,
            work,
            manifest: manifest.map(Arc::new),
            profile,
            assets,
            imports,
            import_gate: Arc::new(tokio::sync::Mutex::new(())),
            media_gate: Arc::new(tokio::sync::Semaphore::new(2)),
        })
    }
    async fn workspace(
        &self,
        hash: String,
        format: &str,
    ) -> Result<(tempfile::TempDir, PathBuf), Error> {
        let dir = tempfile::Builder::new()
            .prefix(".prem-process-")
            .tempdir_in(&self.work)
            .map_err(|_| Error::Storage)?;
        let source = dir.path().join(format!("source.{format}"));
        let mut reader = self
            .assets
            .read(hash.clone())
            .await
            .map_err(|_| Error::Storage)?;
        let mut file = tokio::fs::File::create(&source)
            .await
            .map_err(|_| Error::Storage)?;
        let mut digest = Sha256::new();
        let mut buffer = [0; 65536];
        let mut size = 0;
        loop {
            let n = reader.read(&mut buffer).await.map_err(|_| Error::Storage)?;
            if n == 0 {
                break;
            }
            size += n;
            if size > 50 * 1024 * 1024 {
                return Err(Error::Processing("file_limit"));
            }
            digest.update(&buffer[..n]);
            file.write_all(&buffer[..n])
                .await
                .map_err(|_| Error::Storage)?;
        }
        file.flush().await.map_err(|_| Error::Storage)?;
        drop(file);
        if hex::encode(digest.finalize()) != hash {
            return Err(Error::Processing("source_integrity"));
        }
        Ok((dir, source))
    }
    async fn run(&self, cmd: Command, cancel: CancellationToken) -> Result<(), Error> {
        supervision::run_auxiliary(cmd, cancel).await
    }
    async fn json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, Error> {
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|_| Error::Processing("extract_failed"))?;
        let mut bytes = Vec::new();
        file.take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| Error::Storage)?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(Error::Processing("extraction_limit"));
        }
        serde_json::from_slice(&bytes).map_err(|_| Error::Processing("invalid_extraction"))
    }
}
