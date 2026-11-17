// Purpose: Flush capability-scoped directory changes on macOS and Linux.
// Pattern: Reopen the verified directory for reading before syncing its metadata.
// Usage: Blob upload, derived publication and collection call after changing entries.
// Related: blobs.rs, derived.rs, collection.rs.
use cap_std::fs::Dir;
use std::{io, path::Path};

pub(super) fn sync_directory(root: &Dir, path: &Path) -> io::Result<()> {
    // Linux directory capabilities use O_PATH; fsync needs a readable descriptor.
    root.open_dir(path)?.open(".")?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flushes_directory_and_rejects_file_and_escape() {
        let artifacts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
        std::fs::create_dir_all(&artifacts).unwrap();
        let temporary = tempfile::tempdir_in(artifacts).unwrap();
        let root = Dir::open_ambient_dir(temporary.path(), cap_std::ambient_authority()).unwrap();
        root.create_dir("nested").unwrap();
        root.write("nested/blob", b"durable bytes").unwrap();
        sync_directory(&root, Path::new("nested")).unwrap();
        sync_directory(&root, Path::new(".")).unwrap();
        assert!(sync_directory(&root, Path::new("nested/blob")).is_err());
        assert!(sync_directory(&root, Path::new("..")).is_err());
    }
}
