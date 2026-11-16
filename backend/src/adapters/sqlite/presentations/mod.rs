// Purpose: Implement the presentation persistence port on the serialized SQLite writer.
// Pattern: Preparation, admission, checkpoints and publication have cohesive private owners.
// Usage: App injects this adapter; no domain receives a database handle.
// Related: V19 migration, modules/presentations/.
mod admission;
mod citations;
mod edits;
mod jobs;
mod plans;
mod preparation;
mod publish;
mod queries;
use super::{Queue, Unavailable};
use crate::modules::{assets::DerivedBlob, presentations::*};
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqlitePresentations(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"presentation storage failed");
    Error::Storage
}
fn uuid(s: String) -> Result<Uuid, Error> {
    Uuid::parse_str(&s).map_err(|_| Error::Storage)
}
impl Store for SqlitePresentations {
    fn create_edit(
        &self,
        p: Uuid,
        r: Uuid,
        s: Uuid,
        k: Uuid,
        i: EditRequest,
        profile: String,
    ) -> Work<Edit> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| edits::create(db, p, r, s, k, i, profile))
                .await
        })
    }
    fn edits(&self, p: Uuid, r: Uuid, s: Uuid) -> Work<Vec<Edit>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::list(db, p, r, s)).await })
    }
    fn edit_command(&self, p: Uuid, id: Uuid, k: Uuid, v: i64, a: String) -> Work<Edit> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::command(db, p, id, k, v, a)).await })
    }
    fn claim_edit(&self) -> Work<Option<Edit>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(edits::claim).await })
    }
    fn edit_heartbeat(&self, e: Edit) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::heartbeat(db, e)).await })
    }
    fn edit_context(&self, e: Edit) -> Work<serde_json::Value> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::context(db, e)).await })
    }
    fn edit_ready(&self, e: Edit, b: DerivedBlob, m: String, r: Uuid) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::ready(db, e, b, m, r)).await })
    }
    fn edit_fail(&self, e: Edit, c: String) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::fail(db, e, c)).await })
    }

    fn citations(&self, p: Uuid, id: Uuid, slide: Uuid) -> Work<Vec<Citation>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| citations::read(db, p, id, slide)).await })
    }
    fn preparation(&self, p: Uuid) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::current(db, p)).await })
    }
    fn confirm(&self, p: Uuid, f: String) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::confirm(db, p, f)).await })
    }
    fn design(&self, p: Uuid, i: Design) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::design(db, p, i)).await })
    }
    fn create(&self, p: Uuid, k: Uuid, i: Generate, profile: String) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| admission::create(db, p, k, i, profile))
                .await
        })
    }
    fn runs(&self, p: Uuid) -> Work<Vec<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::runs(db, p)).await })
    }
    fn slides(&self, p: Uuid, id: Uuid) -> Work<Vec<StoredSlide>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::slides(db, p, id)).await })
    }
    fn file(&self, p: Uuid, id: Uuid, slide: Option<Uuid>) -> Work<File> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::file(db, p, id, slide)).await })
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
    fn plan(&self, r: Run) -> Work<Option<Plan>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::next(db, r)).await })
    }
    fn checkpoint(&self, r: Run, s: Uuid, b: DerivedBlob, ids: Vec<Uuid>, req: Uuid) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| plans::checkpoint(db, r, s, b, ids, req))
                .await
        })
    }
    fn render_source(&self, r: Run) -> Work<Option<String>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::render_source(db, r)).await })
    }
    fn complete(&self, r: Run, o: Rendered) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| publish::complete(db, r, o)).await })
    }
    fn fail(&self, r: Run, c: String) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::fail(db, r, c)).await })
    }
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("UPDATE presentation_runs SET status='queued',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running'",[])?;
    db.execute("UPDATE presentation_edits SET status='queued',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running'",[])?;
    Ok(())
}
