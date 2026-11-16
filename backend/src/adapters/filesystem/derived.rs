// Purpose: Publish generated images, package manifests and member bytes in the common Blob Store.
// Pattern: Bounded writes, verified hashes and atomic no-clobber publication on the same filesystem.
// Usage: Document and template process adapters; uploaded originals retain their own validator.
// Related: blobs.rs, modules/assets/mod.rs.
use super::blobs::{Blobs, relative, verify_existing};
use crate::modules::assets::{DerivedBlob, DerivedFormat, Error};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};
pub(super) async fn publish(
    store: &Blobs,
    bytes: Vec<u8>,
    format: DerivedFormat,
) -> Result<DerivedBlob, Error> {
    if (bytes.is_empty() && format != DerivedFormat::Binary) || bytes.len() > 128 * 1024 * 1024 {
        return Err(Error::TooLarge);
    }
    if format == DerivedFormat::Png && !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(Error::InvalidContent);
    }
    if format == DerivedFormat::Zip && !bytes.starts_with(b"PK\x03\x04") {
        return Err(Error::InvalidContent);
    }
    if format == DerivedFormat::Package {
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(Error::TooLarge);
        }
        let package: crate::modules::assets::Package =
            serde_json::from_slice(&bytes).map_err(|_| Error::InvalidContent)?;
        package.validate()?;
    }
    let root = store.root.clone();
    let path = store.path.clone();
    tokio::task::spawn_blocking(move || {
        let hash = hex::encode(Sha256::digest(&bytes));
        let size = bytes.len() as u64;
        let mut file = tempfile::Builder::new()
            .prefix(".puputyx-upload-derived-")
            .tempfile_in(path.join(".staging"))
            .map_err(|_| Error::Storage)?;
        file.write_all(&bytes).map_err(|_| Error::Storage)?;
        file.as_file().sync_all().map_err(|_| Error::Storage)?;
        let dest = relative(&hash)?;
        let parent = dest.parent().ok_or(Error::Storage)?;
        root.create_dir_all(parent).map_err(|_| Error::Storage)?;
        for p in [
            Path::new("sha256").to_path_buf(),
            Path::new("sha256").join(&hash[..2]),
            parent.to_path_buf(),
        ] {
            if root
                .symlink_metadata(&p)
                .map_err(|_| Error::Storage)?
                .file_type()
                .is_symlink()
            {
                return Err(Error::Storage);
            }
        }
        let staged = Path::new(".staging").join(file.path().file_name().ok_or(Error::Storage)?);
        match root.hard_link(staged, &root, &dest) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                verify_existing(&root, &dest, &hash, size)?
            }
            Err(_) => return Err(Error::Storage),
        }
        for p in [
            parent.to_path_buf(),
            Path::new("sha256").join(&hash[..2]),
            Path::new("sha256").to_path_buf(),
            Path::new(".").to_path_buf(),
        ] {
            root.open_dir(p)
                .map_err(|_| Error::Storage)?
                .into_std_file()
                .sync_all()
                .map_err(|_| Error::Storage)?;
        }
        Ok(DerivedBlob {
            sha256: hash,
            size,
            format,
        })
    })
    .await
    .map_err(|_| Error::Storage)?
}
