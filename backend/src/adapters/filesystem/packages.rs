// Purpose: Assemble immutable normalized package members into deterministic download ZIPs.
// Pattern: Bounded admission and temporary-file ownership; cancellation never leaks permanent archives.
// Usage: Called only after the HTTP document adapter authorizes the package identity.
// Related: blobs.rs, modules/assets/packages.rs, adapters/http/documents.rs.
use super::blobs::{Blobs, relative, verify_existing};
use crate::modules::assets::{Error, FileReader, Package};
use std::io::{Read, Seek, SeekFrom, Write};
pub(super) async fn archive(store: &Blobs, hash: String) -> Result<(FileReader, u64), Error> {
    // The permit follows the returned reader and therefore covers slow downloads too.
    let permit = store
        .archives
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error::Busy)?;
    let root = store.root.clone();
    let path = store.path.clone();
    tokio::task::spawn_blocking(move || {
        let mut bytes = Vec::new();
        root.open(relative(&hash)?)
            .map_err(|_| Error::Storage)?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::Storage)?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(Error::TooLarge);
        }
        verify_existing(&root, &relative(&hash)?, &hash, bytes.len() as u64)?;
        let package: Package = serde_json::from_slice(&bytes).map_err(|_| Error::InvalidContent)?;
        package.validate()?;
        let mut file = tempfile::Builder::new()
            .prefix(".puputyx-upload-archive-")
            .tempfile_in(path.join(".staging"))
            .map_err(|_| Error::Storage)?;
        {
            let mut zip = zip::ZipWriter::new(file.as_file_mut());
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .last_modified_time(zip::DateTime::default())
                .unix_permissions(0o644);
            for entry in package.files {
                zip.start_file(entry.path, options)
                    .map_err(|_| Error::Storage)?;
                if entry.size > 0 {
                    let path = relative(&entry.sha256)?;
                    verify_existing(&root, &path, &entry.sha256, entry.size)?;
                    let mut source = root.open(path).map_err(|_| Error::Storage)?;
                    std::io::copy(&mut source, &mut zip).map_err(|_| Error::Storage)?;
                }
            }
            zip.finish()
                .map_err(|_| Error::Storage)?
                .flush()
                .map_err(|_| Error::Storage)?;
        }
        let size = file.as_file().metadata().map_err(|_| Error::Storage)?.len();
        file.as_file_mut()
            .seek(SeekFrom::Start(0))
            .map_err(|_| Error::Storage)?;
        let reader = tokio::fs::File::from_std(file.reopen().map_err(|_| Error::Storage)?);
        Ok((
            Box::new(ArchiveReader {
                reader,
                _file: file,
                _permit: permit,
            }) as FileReader,
            size,
        ))
    })
    .await
    .map_err(|_| Error::Storage)?
}
struct ArchiveReader {
    reader: tokio::fs::File,
    _file: tempfile::NamedTempFile,
    _permit: tokio::sync::OwnedSemaphorePermit,
}
impl tokio::io::AsyncRead for ArchiveReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.reader).poll_read(cx, buffer)
    }
}
