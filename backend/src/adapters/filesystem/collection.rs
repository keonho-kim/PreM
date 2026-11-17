// Purpose: Enumerate and remove only verified content-addressed files during exclusive startup.
// Pattern: Capability-relative operations reject symlink directories and malformed entries.
// Usage: SQLite maintenance passes unreferenced hashes after retention and backup checks.
// Related: sqlite/collection.rs, blobs.rs, storage.rs.
use super::blobs::{relative, verify_existing};
use anyhow::ensure;
use cap_std::fs::Dir;
use std::{collections::BTreeSet, path::Path};
pub(crate) struct CollectionFiles(Dir);
impl CollectionFiles {
    pub fn open(root: &Path) -> anyhow::Result<Self> {
        Ok(Self(Dir::open_ambient_dir(
            root.join("blobs"),
            cap_std::ambient_authority(),
        )?))
    }
    pub fn inventory(&self) -> anyhow::Result<BTreeSet<String>> {
        let mut hashes = BTreeSet::new();
        for first in self.0.read_dir("sha256")? {
            let first = first?;
            ensure!(first.file_type()?.is_dir(), "invalid Blob prefix");
            let a = first.file_name().to_string_lossy().into_owned();
            ensure!(prefix(&a), "invalid Blob prefix");
            for second in self.0.read_dir(Path::new("sha256").join(&a))? {
                let second = second?;
                ensure!(second.file_type()?.is_dir(), "invalid Blob prefix");
                let b = second.file_name().to_string_lossy().into_owned();
                ensure!(prefix(&b), "invalid Blob prefix");
                for file in self.0.read_dir(Path::new("sha256").join(&a).join(&b))? {
                    let file = file?;
                    let hash = file.file_name().to_string_lossy().into_owned();
                    ensure!(file.file_type()?.is_file(), "invalid Blob entry");
                    let path = relative(&hash)?;
                    ensure!(
                        path == Path::new("sha256").join(&a).join(&b).join(&hash),
                        "misplaced Blob"
                    );
                    hashes.insert(hash);
                }
            }
        }
        Ok(hashes)
    }
    pub fn remove(&self, hash: &str) -> anyhow::Result<u64> {
        let path = relative(hash)?;
        match self.0.symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(e) => Err(e.into()),
            Ok(metadata) => {
                verify_existing(&self.0, &path, hash, metadata.len())?;
                self.0.remove_file(&path)?;
                super::durability::sync_directory(
                    &self.0,
                    path.parent()
                        .ok_or_else(|| anyhow::anyhow!("invalid Blob path"))?,
                )?;
                Ok(metadata.len())
            }
        }
    }
}
fn prefix(value: &str) -> bool {
    value.len() == 2
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
