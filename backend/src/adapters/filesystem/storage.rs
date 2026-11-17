// Purpose: Validate the storage root and hold its single-instance lock.
// Pattern: Filesystem-owned guard transferred to the SQLite owner thread.
// Usage: Acquired before opening or migrating the persistent database.
// Related: app/mod.rs, adapters/sqlite/mod.rs.
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

use anyhow::{Context, ensure};

pub(crate) struct Storage {
    _instance_lock: File,
}

impl Storage {
    pub fn initialize(root: &Path) -> anyhow::Result<Self> {
        ensure!(root.is_absolute(), "data storage path must be absolute");
        fs::create_dir_all(root)
            .with_context(|| format!("could not create data storage: {}", root.display()))?;

        ensure!(
            !fs::symlink_metadata(root)?.file_type().is_symlink(),
            "storage root cannot be a symlink"
        );
        let lock_path = root.join(".instance.lock");
        if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
            ensure!(
                !metadata.file_type().is_symlink(),
                "storage lock cannot be a symlink"
            );
        }
        let instance_lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join(".instance.lock"))
            .context("could not open the data storage lock")?;
        instance_lock
            .try_lock()
            .context("data storage is already in use, or locking is unsupported")?;

        for directory in [
            "db",
            "config",
            "blobs/sha256",
            "projects",
            "libraries/references",
            "libraries/templates",
            "work",
            "tmp",
            "logs",
            "backups",
        ] {
            let mut path = root.to_path_buf();
            for part in directory.split('/') {
                path.push(part);
                match fs::symlink_metadata(&path) {
                    Ok(meta) => ensure!(
                        meta.is_dir() && !meta.file_type().is_symlink(),
                        "storage child must be a real directory: {}",
                        path.display()
                    ),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&path)?,
                    Err(e) => return Err(e.into()),
                }
            }
        }

        verify_writes(&root.join("tmp"))?;
        Ok(Self {
            _instance_lock: instance_lock,
        })
    }
}

fn verify_writes(directory: &Path) -> anyhow::Result<()> {
    let source = directory.join(format!(".probe-{}", uuid::Uuid::new_v4()));
    let destination = source.with_extension("ready");
    let result = (|| -> anyhow::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&source)?;
        file.write_all(b"PreM storage probe")?;
        file.sync_all()?;
        drop(file);
        fs::rename(&source, &destination)?;
        File::open(directory)?.sync_all()?;
        fs::remove_file(&destination)?;
        Ok(())
    })();
    let _ = fs::remove_file(source);
    let _ = fs::remove_file(destination);
    result.context("storage write/sync/rename/delete probe failed")
}
