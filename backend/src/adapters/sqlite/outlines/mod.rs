// Purpose: Implement the outline-owned persistence boundary on the existing serialized writer.
// Pattern: Small query, revision and workflow owners share read-only source context.
// Usage: Application composes SqliteOutlines behind the outline Store port.
// Related: context.rs, queries.rs, revisions.rs, jobs.rs, V17 migration.
mod admission;
mod context;
mod execution;
mod jobs;
mod plans;
mod queries;
mod revisions;
use super::{Queue, Unavailable};
use crate::modules::outlines::*;
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteOutlines(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"outline storage failed");
    Error::Storage
}
fn uuid(s: String) -> Result<Uuid, Error> {
    Uuid::parse_str(&s).map_err(|_| Error::Storage)
}
impl Store for SqliteOutlines {
    fn state(&self, p: Uuid, r: Option<Uuid>) -> Work<State> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::state(db, p, r)).await })
    }
    fn save(&self, p: Uuid, e: Edit) -> Work<State> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| revisions::save(db, p, e)).await })
    }
    fn confirm(&self, p: Uuid, v: i64) -> Work<State> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| revisions::confirm(db, p, v)).await })
    }
    fn revisions(&self, p: Uuid) -> Work<Vec<Revision>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::history(db, p)).await })
    }
    fn blocks(
        &self,
        p: Uuid,
        r: Option<Uuid>,
        s: String,
        o: u32,
        ids: Option<Vec<Uuid>>,
    ) -> Work<Blocks> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::blocks(db, p, r, s, o, ids)).await })
    }
    fn create(&self, p: Uuid, k: Uuid, i: Generate) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::create(db, p, k, i)).await })
    }
    fn command(&self, p: Uuid, id: Uuid, k: Uuid, v: i64, a: String) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::command(db, p, id, k, v, a)).await })
    }
    fn claim(&self) -> Work<Option<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(jobs::claim).await })
    }
    fn heartbeat(&self, r: Run) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::heartbeat(db, r)).await })
    }
    fn begin_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::begin(db, r, n)).await })
    }
    fn finish_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::finish(db, r, n)).await })
    }
    fn plan(&self, r: Run) -> Work<Option<Plan>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::next(db, r)).await })
    }
    fn checkpoint(&self, r: Run, b: i64, v: serde_json::Value, id: Uuid) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::checkpoint(db, r, b, v, id)).await })
    }
    fn complete(&self, r: Run) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::complete(db, r)).await })
    }
    fn fail(&self, r: Run, c: String) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::fail(db, r, c)).await })
    }
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    execution::recover(db)
}
