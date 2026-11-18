// Purpose: Materialize verified OCR models into application-owned writable cache directories.
// Pattern: Bundled models are immutable; cache repair uses same-filesystem atomic writes.
// Usage: Runtime initialization before Kordoc executes offline.
// Related: mod.rs, scripts/runtime/documents.mjs, storage root config/.
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
pub(super) fn prepare(data: &Path, runtime: &Path) -> anyhow::Result<PathBuf> {
    let root = data.join("config/kordoc-cache");
    for dir in [&root, &root.join("ppocr")] {
        if let Ok(meta) = std::fs::symlink_metadata(dir) {
            anyhow::ensure!(
                meta.is_dir() && !meta.file_type().is_symlink(),
                "invalid OCR cache directory"
            );
        } else {
            std::fs::create_dir(dir)?;
        }
    }
    for name in ["det.onnx", "rec_korean.onnx", "rec_korean.yml"] {
        let bytes = std::fs::read(runtime.join("kordoc/models/ppocr").join(name))?;
        let dest = root.join("ppocr").join(name);
        if let Ok(meta) = std::fs::symlink_metadata(&dest) {
            anyhow::ensure!(
                meta.is_file() && !meta.file_type().is_symlink(),
                "invalid OCR cache file"
            );
            if Sha256::digest(std::fs::read(&dest)?).as_slice() == Sha256::digest(&bytes).as_slice()
            {
                continue;
            }
        }
        let mut file = tempfile::NamedTempFile::new_in(root.join("ppocr"))?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(dest)?;
    }
    Ok(root)
}
