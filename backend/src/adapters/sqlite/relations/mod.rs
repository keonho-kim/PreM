// Purpose: Implement relation-search persistence on the existing bounded SQLite writer.
// Pattern: One table owner delegates cohesive retrieval, lifecycle, projection and selection responsibilities.
// Usage: Database exposes only the consumer-owned Relations Store.
// Related: modules/relations/, V14__related_documents.sql.
mod context;
mod execution;
mod exploration;
mod lifecycle;
mod pull;
mod queries;
mod reads;
mod retrieval;
mod selections;
mod settings;
use super::{Queue, Unavailable};
use crate::modules::relations::*;
use rusqlite::params;
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteRelations(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Busy
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"relation storage failed");
    Error::Storage
}
fn uuid(s: String) -> Result<Uuid, Error> {
    Uuid::parse_str(&s).map_err(|_| Error::Storage)
}
impl Store for SqliteRelations {
    fn begin_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::begin(db, r, n)).await })
    }
    fn finish_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::finish(db, r, n)).await })
    }
    fn reviewed(&self, r: Run, b: bool) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::reviewed(db, r, b)).await })
    }

    fn advance(&self, r: Run) -> Work<Next> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| exploration::advance(db, r)).await })
    }
    fn pull(&self, r: Run, queries: Vec<String>, request: Option<Uuid>) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| pull::apply(db, r, queries, request)).await })
    }
    fn evidence(&self, p: Uuid, c: Uuid) -> Work<Vec<EvidenceRead>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| reads::evidence(db, p, c)).await })
    }

    fn create(&self, p: Uuid, k: Uuid, s: Search) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| lifecycle::create(db, p, k, s)).await })
    }
    fn get(&self, p: Uuid, id: Option<Uuid>) -> Work<Option<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::get(db, p, id)).await })
    }
    fn results(&self, p: Uuid, id: Uuid, k: String, o: u32) -> Work<Results> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::results(db, p, id, k, o)).await })
    }
    fn origins(&self, p: Uuid, id: Uuid, o: u32) -> Work<Vec<Origin>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                queries::candidate_project(db, p, id)?;
                queries::origins(db, id, o, None)
            })
            .await
        })
    }
    fn command(&self, p: Uuid, id: Uuid, e: i64, k: Uuid, a: String) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| lifecycle::command(db, p, id, e, k, a))
                .await
        })
    }
    fn settings(&self, e: Option<Settings>) -> Work<Settings> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| settings::save(db, e)).await })
    }
    fn select(&self, p: Uuid, s: SelectItem) -> Work<Selection> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| selections::select(db, p, s)).await })
    }
    fn selections(&self, p: Uuid) -> Work<Results> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| selections::list(db, p)).await })
    }
    fn claim(&self) -> Work<Option<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(lifecycle::claim).await })
    }
    fn heartbeat(&self, r: Run) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| lifecycle::heartbeat(db, &r)).await })
    }
    fn plan(&self, r: Run) -> Work<Plan> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                queries::active(db, &r)?;
                context::plan(db, &r)
            })
            .await
        })
    }
    fn cached(&self, r: Run, k: Vec<(Uuid, String)>) -> Work<Vec<Uuid>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| lifecycle::cached(db, r, k)).await })
    }
    fn commit(&self, r: Run, v: Vec<Assessment>) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| lifecycle::commit(db, r, v)).await })
    }
    fn finish(&self, r: Run, s: String, e: Option<String>) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| lifecycle::finish(db, r, s, e)).await })
    }
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("UPDATE relation_runs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='server_restarted',lease=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE status='running'",params![now()])?;
    Ok(())
}
