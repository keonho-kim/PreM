// Purpose: Own application storage validation and instance locking.
// Pattern: Filesystem boundary with a process-lifetime lock guard.
// Usage: Acquired by app before opening the database.
// Related: storage.rs, app/mod.rs.
mod storage;
pub(crate) use storage::Storage;

mod blobs;
pub(crate) use blobs::Blobs;

mod secrets;
pub(crate) use secrets::Secrets;

mod derived;

mod packages;

mod collection;
pub(crate) use collection::CollectionFiles;
