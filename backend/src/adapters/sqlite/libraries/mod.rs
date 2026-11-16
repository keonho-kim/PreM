// Purpose: Implement the library persistence port on the shared async SQLite worker.
// Pattern: Queries, metadata writes and upload commits each have one cohesive SQL owner.
// Usage: Constructed by Database::libraries and consumed through LibraryService.
// Related: queries.rs, writes.rs, uploads.rs, modules/libraries/ports.rs.
mod queries;
mod uploads;
pub(super) use uploads::recover_interrupted;
mod writes;
use super::Queue;
use crate::modules::libraries::*;
use rusqlite::Connection;
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteLibraries(pub Arc<Queue>);
fn storage(error: rusqlite::Error) -> Error {
    tracing::error!(%error,"library database operation failed");
    Error::Storage
}
impl LibraryStore for SqliteLibraries {
    fn list(&self, q: ListQuery) -> StoreFuture<ItemList> {
        let queue = self.0.clone();
        Box::pin(async move { queue.call(move |db| queries::list(db, q)).await })
    }
    fn get(&self, k: Kind, id: Uuid) -> StoreFuture<Item> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::get(db, k, id, false)).await })
    }
    fn versions(&self, k: Kind, id: Uuid) -> StoreFuture<Vec<FileVersion>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::versions(db, k, id)).await })
    }
    fn begin(&self, u: Upload, now: i64) -> StoreFuture<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| uploads::begin(db, u, now)).await })
    }
    fn failed(&self, u: Upload) -> StoreFuture<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{db.execute("UPDATE upload_requests SET state='failed' WHERE request_key=?1 AND attempt=?2 AND state='receiving'",rusqlite::params![u.key.to_string(),u.attempt.to_string()]).map_err(storage)?;Ok(())}).await
        })
    }
    fn register(&self, r: Register) -> StoreFuture<Saved> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| uploads::register(db, r)).await })
    }
    fn change(&self, k: Kind, id: Uuid, v: i64, c: Change, now: i64) -> StoreFuture<Item> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| writes::change(db, k, id, v, c, now)).await })
    }
    fn cancel(&self, key: Uuid, now: i64) -> StoreFuture<UploadStatus> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| uploads::cancel(db, key, now)).await })
    }
    fn upload_status(&self, key: Uuid) -> StoreFuture<UploadStatus> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| uploads::status(db, key)).await })
    }
}
fn uuid(value: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&value).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
fn tags(db: &Connection, k: Kind, id: Uuid) -> Result<Vec<String>, Error> {
    if k.project().is_some() {
        return Ok(vec![]);
    }
    let p = k.prefix();
    let mut s=db.prepare(&format!("SELECT t.name FROM {p}_tags t JOIN {p}_tag_links l ON l.tag_id=t.id WHERE l.item_id=?1 ORDER BY t.name")).map_err(storage)?;
    s.query_map([id.to_string()], |r| r.get(0))
        .map_err(storage)?
        .collect::<rusqlite::Result<_>>()
        .map_err(storage)
}
