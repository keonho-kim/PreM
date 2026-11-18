// Purpose: Prepare independently reusable reference slides and artwork alongside Kordoc content.
// Pattern: PPT Master native package remains separate from template library registration.
// Usage: PPTX reference extraction; all outputs enter the same immutable extraction checkpoint.
// Related: pptx.rs, documents.rs, backend/tools/reference-materials.py.
use super::*;
use crate::modules::{
    assets::DerivedFormat,
    documents::{Extracted, ExtractedFile, NativeMaterial, NativePackage},
};
#[derive(Deserialize)]
struct Prepared {
    materials: Vec<NativeMaterial>,
    files: Vec<ExtractedFile>,
}
impl Runtime {
    pub(super) async fn reference_materials(
        &self,
        source: &Path,
        dir: &Path,
        result: &mut Extracted,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let (analysis, bundle) = self.import_pptx(source, dir, cancel.clone(), true).await?;
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("runtime_missing"))?;
        let mut scan = Command::new(&manifest.python);
        scan.arg(self.root.join("reference-materials.py"))
            .arg(&self.root)
            .arg(source)
            .arg(dir)
            .current_dir(dir)
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir);
        supervision::run_document("extract_reference_objects", scan, cancel.clone()).await?;
        let mut render = Command::new(&manifest.node);
        render
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.display()))
            .arg(format!("--allow-fs-write={}", dir.display()))
            .arg(self.root.join("reference-previews.mjs"))
            .arg(&self.root)
            .arg(dir)
            .current_dir(dir);
        supervision::run_document("render_reference_objects", render, cancel.clone()).await?;
        let prepared: Prepared = Self::json(&dir.join("material-previews.json")).await?;
        if prepared.files.len() > 1000 || prepared.materials.len() > 10000 {
            return Err(Error::Processing("extraction_limit"));
        }
        let mut total = 0;
        for f in prepared.files {
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
            let path = dir.join(format!("{}.png", f.sha256));
            let meta = tokio::fs::symlink_metadata(&path)
                .await
                .map_err(|_| Error::Storage)?;
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != f.size {
                return Err(Error::Processing("invalid_extraction"));
            }
            let bytes = tokio::fs::read(path).await.map_err(|_| Error::Storage)?;
            if hex::encode(Sha256::digest(&bytes)) != f.sha256 {
                return Err(Error::Processing("invalid_extraction"));
            }
            self.assets
                .publish(bytes, DerivedFormat::Png)
                .await
                .map_err(|_| Error::Storage)?;
            if !result.files.iter().any(|old| old.sha256 == f.sha256) {
                result.files.push(f);
            }
        }
        for preview in analysis.previews {
            if let Some(page) = result
                .pages
                .iter_mut()
                .find(|p| p.source_page == Some(preview.ordinal))
            {
                page.preview = Some(preview.sha256.clone());
            } else {
                result.pages.push(crate::modules::documents::ExtractedPage {
                    source_page: Some(preview.ordinal),
                    label: format!("슬라이드 {}", preview.ordinal),
                    preview: Some(preview.sha256.clone()),
                    blocks: vec![],
                });
            }
            if !result.files.iter().any(|f| f.sha256 == preview.sha256) {
                result.files.push(ExtractedFile {
                    sha256: preview.sha256,
                    size: preview.size,
                });
            }
        }
        result.pages.sort_by_key(|p| p.source_page);
        result.native = Some(NativePackage {
            bundle: ExtractedFile {
                sha256: bundle.sha256,
                size: bundle.size,
            },
            materials: prepared.materials,
        });
        Ok(())
    }
}
