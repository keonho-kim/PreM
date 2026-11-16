// Purpose: Define atomic library persistence and upload outcome contracts.
// Pattern: Consumer-owned async port, independent of SQLite and HTTP.
// Usage: LibraryService delegates short queries/transactions to one store.
// Related: mod.rs, adapters/sqlite/libraries/.
use super::*;
use std::{future::Future, pin::Pin};
pub(crate) type StoreFuture<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait LibraryStore: Send + Sync {
    fn list(&self, query: ListQuery) -> StoreFuture<ItemList>;
    fn get(&self, kind: Kind, id: Uuid) -> StoreFuture<Item>;
    fn versions(&self, kind: Kind, id: Uuid) -> StoreFuture<Vec<FileVersion>>;
    fn begin(&self, upload: Upload, now: i64) -> StoreFuture<()>;
    fn failed(&self, upload: Upload) -> StoreFuture<()>;
    fn register(&self, request: Register) -> StoreFuture<Saved>;
    fn change(
        &self,
        kind: Kind,
        id: Uuid,
        version: i64,
        change: Change,
        now: i64,
    ) -> StoreFuture<Item>;
    fn cancel(&self, key: Uuid, now: i64) -> StoreFuture<UploadStatus>;
    fn upload_status(&self, key: Uuid) -> StoreFuture<UploadStatus>;
}
