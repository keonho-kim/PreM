// Purpose: Share bounded PPT Master import and rendering between template and reference adapters.
// Pattern: Produces native data and passive previews without choosing a library or writing feature rows.
// Usage: Callers supply one owned workspace and preserve their own workflow checkpoints.
// Related: templates.rs, reference_pptx.rs, backend/tools/template-extract.py.
use super::*;
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat},
    ppt_imports::{Analysis, Preview},
};
impl Runtime {
    pub(super) async fn import_pptx(
        &self,
        source: &Path,
        dir: &Path,
        cancel: CancellationToken,
        rehydrate: bool,
    ) -> Result<(Analysis, DerivedBlob), Error> {
        let _gate = tokio::select! { ()=cancel.cancelled()=>return Err(Error::Cancelled), guard=self.import_gate.lock()=>guard };
        let bytes = tokio::fs::read(source).await.map_err(|_| Error::Storage)?;
        let source_hash = hex::encode(Sha256::digest(&bytes));
        drop(bytes);
        if let Some(blob) = self
            .imports
            .find(source_hash.clone(), self.profile.clone())
            .await
            .map_err(|_| Error::Storage)?
        {
            let analysis = self
                .imports
                .analysis(blob.sha256.clone())
                .await
                .map_err(|_| Error::Storage)?;
            if rehydrate {
                self.restore_package(blob.sha256.clone(), dir, &analysis, &cancel)
                    .await?;
            }
            return Ok((analysis, blob));
        }
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("template_runtime_missing"))?;
        let mut cmd = Command::new(&manifest.python);
        cmd.arg(self.root.join("template-extract.py"))
            .arg(&self.root)
            .arg(source)
            .arg(dir)
            .current_dir(dir)
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir);
        supervision::run_document("import_slides", cmd, cancel.clone())
            .await
            .map_err(import_error)?;
        let mut result: Analysis = Self::json(&dir.join("result.json"))
            .await
            .map_err(|_| Error::Processing("template_extract_failed"))?;
        let mut render = Command::new(&manifest.node);
        render
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.display()))
            .arg(format!("--allow-fs-write={}", dir.display()))
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(self.root.join("template-previews.mjs"))
            .arg(&self.root)
            .arg(dir)
            .current_dir(dir);
        supervision::run_document("render_slides", render, cancel.clone())
            .await
            .map_err(import_error)?;
        let previews: Vec<Preview> = Self::json(&dir.join("previews.json"))
            .await
            .map_err(|_| Error::Processing("template_extract_failed"))?;
        if previews.is_empty() || previews.len() > 500 {
            return Err(Error::Processing("template_extract_failed"));
        }
        for mut p in previews {
            if p.ordinal < 1 || p.ordinal > 500 {
                return Err(Error::Processing("template_extract_failed"));
            }
            let path = dir.join(format!("preview-{}.png", p.ordinal));
            let meta = tokio::fs::symlink_metadata(&path)
                .await
                .map_err(|_| Error::Processing("template_extract_failed"))?;
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4 * 1024 * 1024 {
                return Err(Error::Processing("template_extract_failed"));
            }
            let bytes = tokio::fs::read(path).await.map_err(|_| Error::Storage)?;
            let blob = self
                .assets
                .publish(bytes, DerivedFormat::Png)
                .await
                .map_err(|_| Error::Storage)?;
            p.sha256 = blob.sha256;
            p.size = blob.size;
            result.previews.push(p);
        }
        let (blob, package) = self.capture_package(dir, &result, &cancel).await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.imports
            .commit(source_hash, self.profile.clone(), blob.clone(), package)
            .await
            .map_err(|_| Error::Storage)?;
        Ok((result, blob))
    }
}

fn import_error(error: Error) -> Error {
    match error {
        Error::Cancelled | Error::Processing("document_step_timeout") => error,
        _ => Error::Processing("template_extract_failed"),
    }
}
