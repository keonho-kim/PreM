// Purpose: Stream uploads into owned staging files and publish content-addressed bytes.
// Pattern: tempfile cleanup, cap-std directory-relative publication and bounded parsing.
// Usage: AssetService receives this adapter; permanent bytes are never overwritten.
// Related: modules/assets/mod.rs, adapters/formats/, storage.rs.
use crate::{adapters::formats, modules::assets::*};
use cap_std::fs::Dir;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tempfile::NamedTempFile;
use tokio::{
    io::AsyncWriteExt,
    sync::{OwnedSemaphorePermit, Semaphore},
};
use tokio_util::sync::CancellationToken;
pub(crate) struct Blobs {
    pub(super) root: Arc<Dir>,
    pub(super) path: PathBuf,
    slots: Arc<Semaphore>,
    pub(super) archives: Arc<Semaphore>,
    closed: AtomicBool,
}
impl Blobs {
    pub fn open(data: &Path) -> anyhow::Result<Self> {
        let path = data.join("blobs");
        let root = Dir::open_ambient_dir(&path, cap_std::ambient_authority())?;
        root.create_dir_all(".staging")?;
        anyhow::ensure!(
            !root.symlink_metadata(".staging")?.file_type().is_symlink(),
            "Blob staging cannot be a symlink"
        );
        // The process holds the application storage lock; only our abandoned staging files are removed.
        for entry in root.read_dir(".staging")? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(".prem-upload-")
            {
                anyhow::ensure!(entry.file_type()?.is_file(), "invalid staging entry");
                root.remove_file(Path::new(".staging").join(entry.file_name()))?;
            }
        }
        Ok(Self {
            root: Arc::new(root),
            path,
            slots: Arc::new(Semaphore::new(2)),
            archives: Arc::new(Semaphore::new(1)),
            closed: AtomicBool::new(false),
        })
    }
}
struct Staged {
    file: NamedTempFile,
    writer: tokio::fs::File,
    root: Arc<Dir>,
    hash: Sha256,
    size: u64,
    _permit: OwnedSemaphorePermit,
}
fn io_error(error: std::io::Error) -> Error {
    tracing::warn!(%error,"Blob storage operation failed");
    if error.kind() == std::io::ErrorKind::StorageFull {
        Error::NoSpace
    } else {
        Error::Storage
    }
}
pub(super) fn relative(hash: &str) -> Result<PathBuf, Error> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(Error::Storage);
    }
    Ok(Path::new("sha256")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(hash))
}
impl BlobStorage for Blobs {
    fn archive(&self, hash: String) -> AssetFuture<'_, (FileReader, u64)> {
        Box::pin(async move {
            if self.closed.load(Ordering::Acquire) {
                return Err(Error::Busy);
            }
            super::packages::archive(self, hash).await
        })
    }
    fn publish(&self, bytes: Vec<u8>, format: DerivedFormat) -> AssetFuture<'_, DerivedBlob> {
        Box::pin(super::derived::publish(self, bytes, format))
    }
    fn shutdown(&self) -> AssetFuture<'_, ()> {
        Box::pin(async move {
            self.closed.store(true, Ordering::Release);
            let _all = self
                .slots
                .clone()
                .acquire_many_owned(2)
                .await
                .map_err(|_| Error::Busy)?;
            self.slots.close();
            let _archive = self
                .archives
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| Error::Busy)?;
            self.archives.close();
            Ok(())
        })
    }
    fn stage(&self) -> AssetFuture<'_, Box<dyn UploadSink>> {
        Box::pin(async move {
            if self.closed.load(Ordering::Acquire) {
                return Err(Error::Busy);
            }
            let permit = self
                .slots
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Busy)?;
            let path = self.path.clone();
            let root = self.root.clone();
            let staged = tokio::task::spawn_blocking(move || {
                // Reserve room for both admitted uploads; actual write errors still remain authoritative.
                if fs4::available_space(&path).map_err(io_error)?
                    < MAX_FILE_BYTES * 2 + 16 * 1024 * 1024
                {
                    return Err(Error::NoSpace);
                }
                let file = tempfile::Builder::new()
                    .prefix(".prem-upload-")
                    .tempfile_in(path.join(".staging"))
                    .map_err(io_error)?;
                let writer =
                    tokio::fs::File::from_std(file.as_file().try_clone().map_err(io_error)?);
                Ok(Staged {
                    file,
                    writer,
                    root,
                    hash: Sha256::new(),
                    size: 0,
                    _permit: permit,
                })
            })
            .await
            .map_err(|_| Error::Storage)??;
            Ok(Box::new(staged) as Box<dyn UploadSink>)
        })
    }
    fn read(&self, hash: String) -> AssetFuture<'_, FileReader> {
        Box::pin(async move {
            let root = self.root.clone();
            let file = tokio::task::spawn_blocking(move || {
                let path = relative(&hash)?;
                let meta = root.symlink_metadata(&path).map_err(io_error)?;
                if !meta.is_file() || meta.file_type().is_symlink() {
                    return Err(Error::Storage);
                }
                root.open(path).map(|f| f.into_std()).map_err(io_error)
            })
            .await
            .map_err(|_| Error::Storage)??;
            Ok(Box::new(tokio::fs::File::from_std(file)) as FileReader)
        })
    }
}
impl UploadSink for Staged {
    fn write<'a>(&'a mut self, data: &'a [u8]) -> AssetFuture<'a, ()> {
        Box::pin(async move {
            self.size = self
                .size
                .checked_add(data.len() as u64)
                .ok_or(Error::TooLarge)?;
            if self.size > MAX_FILE_BYTES {
                return Err(Error::TooLarge);
            }
            self.writer.write_all(data).await.map_err(io_error)?;
            self.hash.update(data);
            Ok(())
        })
    }
    fn finish(
        mut self: Box<Self>,
        format: Format,
        cancel: CancellationToken,
    ) -> AssetFuture<'static, Blob> {
        Box::pin(async move {
            if self.size == 0 {
                return Err(Error::InvalidFile);
            }
            self.writer.flush().await.map_err(io_error)?;
            self.writer.sync_all().await.map_err(io_error)?;
            tokio::task::spawn_blocking(move || {
                formats::inspect(self.file.as_file_mut(), format, &cancel)?;
                if cancel.is_cancelled() {
                    return Err(Error::Cancelled);
                }
                let hash = hex::encode(self.hash.clone().finalize());
                let destination = relative(&hash)?;
                let parent = destination.parent().ok_or(Error::Storage)?;
                self.root.create_dir_all(parent).map_err(io_error)?;
                for p in [
                    PathBuf::from("sha256"),
                    Path::new("sha256").join(&hash[..2]),
                    parent.to_path_buf(),
                ] {
                    let m = self.root.symlink_metadata(p).map_err(io_error)?;
                    if !m.is_dir() || m.file_type().is_symlink() {
                        return Err(Error::Storage);
                    }
                }
                let staging =
                    Path::new(".staging").join(self.file.path().file_name().ok_or(Error::Storage)?);
                match self.root.hard_link(&staging, &self.root, &destination) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        verify_existing(&self.root, &destination, &hash, self.size)?;
                    }
                    Err(e) => return Err(io_error(e)),
                }
                for directory in [
                    parent.to_path_buf(),
                    Path::new("sha256").join(&hash[..2]),
                    PathBuf::from("sha256"),
                    PathBuf::from("."),
                ] {
                    super::durability::sync_directory(&self.root, &directory).map_err(io_error)?;
                }
                Ok(Blob {
                    sha256: hash,
                    size: self.size,
                    format,
                })
            })
            .await
            .map_err(|_| Error::Storage)?
        })
    }
}
pub(super) fn verify_existing(
    root: &Dir,
    path: &Path,
    expected: &str,
    size: u64,
) -> Result<(), Error> {
    let meta = root.symlink_metadata(path).map_err(io_error)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != size {
        return Err(Error::Storage);
    }
    let mut file: File = root.open(path).map_err(io_error)?.into_std();
    file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(io_error)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if hex::encode(hash.finalize()) != expected {
        return Err(Error::Storage);
    }
    Ok(())
}
