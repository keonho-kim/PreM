// Purpose: Render and verify editable decks with bundled PPT Master, python-pptx and Kordoc.
// Pattern: Owned temporary directory, bounded subprocesses and passive PNG outputs.
// Usage: Presentation worker supplies validated specs and an optional immutable template Blob.
// Related: backend/tools/presentation-render.py, presentation-validate.mjs.
use super::*;
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat},
    presentations::{self, RenderInput, Rendered, Work},
};
impl presentations::Renderer for Runtime {
    fn profile(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.profile.as_bytes());
        h.update(include_bytes!("../../../tools/presentation-render.py"));
        h.update(include_bytes!("../../../tools/presentation-validate.mjs"));
        h.update(include_bytes!("../../../../scripts/runtime-python.lock"));
        hex::encode(h.finalize())
    }
    fn render(&self, input: RenderInput, cancel: CancellationToken) -> Work<Rendered> {
        let this = self.clone();
        Box::pin(async move {
            this.render_presentation(input, cancel)
                .await
                .map_err(|e| match e {
                    Error::Cancelled => presentations::Error::Cancelled,
                    Error::Processing(c) => presentations::Error::Processing(c),
                    _ => presentations::Error::Storage,
                })
        })
    }
}
impl Runtime {
    async fn render_presentation(
        &self,
        input: RenderInput,
        cancel: CancellationToken,
    ) -> Result<Rendered, Error> {
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("runtime_missing"))?;
        for (name, expected) in [
            (
                "presentation-render.py",
                include_bytes!("../../../tools/presentation-render.py").as_slice(),
            ),
            (
                "presentation-validate.mjs",
                include_bytes!("../../../tools/presentation-validate.mjs").as_slice(),
            ),
        ] {
            let installed = tokio::fs::read(self.root.join(name))
                .await
                .map_err(|_| Error::Processing("runtime_missing"))?;
            if installed != expected {
                return Err(Error::Processing("runtime_changed"));
            }
        }
        let dir = tempfile::Builder::new()
            .prefix(".puputyx-process-")
            .tempdir_in(&self.work)
            .map_err(|_| Error::Storage)?;
        if let Some(hash) = input.template_sha256 {
            let bytes = self
                .assets
                .bytes(hash, 50 * 1024 * 1024)
                .await
                .map_err(|_| Error::Storage)?;
            tokio::fs::write(dir.path().join("template.pptx"), bytes)
                .await
                .map_err(|_| Error::Storage)?;
        }
        let specs: Vec<_> = input.specs.iter().map(|(_, s)| s).collect();
        tokio::fs::write(
            dir.path().join("specs.json"),
            serde_json::to_vec(&specs).map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        let mut cmd = Command::new(&manifest.python);
        cmd.arg(self.root.join("presentation-render.py"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir.path());
        self.run(cmd, cancel.clone()).await.map_err(|e| match e {
            Error::Cancelled => e,
            _ => Error::Processing("presentation_render_failed"),
        })?;
        let mut verify = Command::new(&manifest.node);
        verify
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.path().display()))
            .arg(format!("--allow-fs-write={}", dir.path().display()))
            .arg(self.root.join("presentation-validate.mjs"))
            .arg(dir.path())
            .current_dir(dir.path())
            .env("KORDOC_OFFLINE", "1");
        self.run(verify, cancel.clone())
            .await
            .map_err(|e| match e {
                Error::Cancelled => e,
                _ => Error::Processing("presentation_validation_failed"),
            })?;
        let mut preview = Command::new(&manifest.python);
        preview
            .arg(self.root.join("template-extract.py"))
            .arg(&self.root)
            .arg(dir.path().join("output.pptx"))
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir.path());
        self.run(preview, cancel.clone()).await?;
        let mut raster = Command::new(&manifest.node);
        raster
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.path().display()))
            .arg(format!("--allow-fs-write={}", dir.path().display()))
            .arg(self.root.join("template-previews.mjs"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path());
        self.run(raster, cancel.clone()).await?;
        let mut previews = vec![];
        for n in 1..=input.specs.len() {
            previews.push(
                self.presentation_blob(
                    &dir.path().join(format!("preview-{n}.png")),
                    4 * 1024 * 1024,
                    DerivedFormat::Png,
                )
                .await?,
            );
        }
        let output = self
            .presentation_blob(
                &dir.path().join("output.pptx"),
                50 * 1024 * 1024,
                DerivedFormat::Binary,
            )
            .await?;
        Ok(Rendered { output, previews })
    }
    async fn presentation_blob(
        &self,
        path: &Path,
        limit: u64,
        format: DerivedFormat,
    ) -> Result<DerivedBlob, Error> {
        let meta = tokio::fs::symlink_metadata(path)
            .await
            .map_err(|_| Error::Storage)?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
            return Err(Error::Processing("output_limit"));
        }
        self.assets
            .publish(
                tokio::fs::read(path).await.map_err(|_| Error::Storage)?,
                format,
            )
            .await
            .map_err(|_| Error::Storage)
    }
}
