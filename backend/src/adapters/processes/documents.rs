// Purpose: Adapt offline Kordoc output to immutable reference extraction values.
// Pattern: Generated binary artifacts enter the shared Blob Store before the DB checkpoint.
// Usage: Reference jobs only; template analysis has its own adapter.
// Related: mod.rs, html.rs, backend/tools/document-extract.mjs.
use super::*;
use crate::modules::{
    assets::DerivedFormat,
    documents::{Extracted, Extractor, Job, Work},
};
impl Extractor for Runtime {
    fn profile(&self) -> crate::modules::documents::ExtractionProfiles {
        crate::modules::documents::ExtractionProfiles {
            document: self.profile.clone(),
            markdown: crate::adapters::markdown::PROFILE.into(),
        }
    }
    fn extract(&self, job: Job, cancel: CancellationToken) -> Work<Extracted> {
        let this = self.clone();
        Box::pin(async move {
            if !["pdf", "hwp", "hwpx", "docx", "pptx", "xlsx", "html", "md"]
                .contains(&job.format.as_str())
            {
                return Err(Error::Processing("unsupported_format"));
            }
            if job.profile != this.profile().for_format(&job.format) {
                return Err(Error::Processing("profile_unavailable"));
            }
            let (dir, source) = this.workspace(job.source_sha256, &job.format).await?;
            if job.format == "md" {
                let bytes = tokio::fs::read(source).await.map_err(|_| Error::Storage)?;
                return tokio::task::spawn_blocking(move || {
                    crate::adapters::markdown::extract(bytes, cancel)
                })
                .await
                .map_err(|_| Error::Processing("extract_failed"))?;
            }
            if job.format == "html" {
                let bytes = tokio::fs::read(source).await.map_err(|_| Error::Storage)?;
                return tokio::task::spawn_blocking(move || super::html::extract(bytes, cancel))
                    .await
                    .map_err(|_| Error::Processing("extract_failed"))?;
            }
            let manifest = this
                .manifest
                .as_ref()
                .ok_or(Error::Processing("runtime_missing"))?;
            let mut cmd = Command::new(&manifest.node);
            cmd.arg(format!("--allow-fs-read={}", this.cache.display()))
                .arg(format!("--allow-fs-write={}", this.cache.display()));
            cmd.arg("--max-old-space-size=1024")
                .arg("--permission")
                .arg("--allow-addons")
                .arg("--allow-worker")
                .arg(format!("--allow-fs-read={}", this.root.display()))
                .arg(format!("--allow-fs-read={}", dir.path().display()))
                .arg(format!("--allow-fs-write={}", dir.path().display()))
                .arg(this.root.join("document-extract.mjs"))
                .arg(&source)
                .arg(dir.path())
                .current_dir(dir.path())
                .env("KORDOC_OFFLINE", "1")
                .env("KORDOC_MODEL_CACHE", &this.cache)
                .env("KORDOC_MAX_UNZIP_MB", "256")
                .env("TMPDIR", dir.path());
            this.run(cmd, cancel.clone()).await?;
            let mut result: Extracted = Self::json(&dir.path().join("result.json")).await?;
            if result.files.len() > 1000 {
                return Err(Error::Processing("extraction_limit"));
            }
            let mut total = 0;
            for f in &result.files {
                if cancel.is_cancelled() {
                    return Err(Error::Cancelled);
                }
                if f.sha256.len() != 64
                    || !f.sha256.bytes().all(|b| b.is_ascii_hexdigit())
                    || f.size > 4 * 1024 * 1024
                {
                    return Err(Error::Processing("invalid_extraction"));
                }
                total += f.size;
                if total > 64 * 1024 * 1024 {
                    return Err(Error::Processing("extraction_limit"));
                }
                let path = dir.path().join(format!("{}.png", f.sha256));
                let metadata = tokio::fs::symlink_metadata(&path)
                    .await
                    .map_err(|_| Error::Storage)?;
                if !metadata.is_file()
                    || metadata.file_type().is_symlink()
                    || metadata.len() != f.size
                {
                    return Err(Error::Processing("invalid_extraction"));
                }
                let bytes = tokio::fs::read(path).await.map_err(|_| Error::Storage)?;
                if hex::encode(Sha256::digest(&bytes)) != f.sha256 {
                    return Err(Error::Processing("invalid_extraction"));
                }
                this.assets
                    .publish(bytes, DerivedFormat::Png)
                    .await
                    .map_err(|_| Error::Storage)?;
            }
            if job.format == "pptx" {
                this.reference_materials(&source, dir.path(), &mut result, cancel)
                    .await?;
            }
            Ok(result)
        })
    }
}
