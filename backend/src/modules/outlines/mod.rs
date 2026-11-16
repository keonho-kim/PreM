// Purpose: Own versioned presentation outlines and canonical source-content assignment.
// Pattern: Explicit CAS edits and durable model work through narrow persistence contracts.
// Usage: Studio outline step; existing model execution owns credentials/admission/history.
// Related: types.rs, validation.rs, worker.rs, adapters/sqlite/outlines/.
mod model;
mod types;
mod validation;
mod worker;
pub(crate) use model::{generated_draft, mapped_assignments};
use std::{future::Future, pin::Pin, sync::Arc};
pub(crate) use types::*;
use uuid::Uuid;
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn state(&self, p: Uuid, revision: Option<Uuid>) -> Work<State>;
    fn save(&self, p: Uuid, edit: Edit) -> Work<State>;
    fn confirm(&self, p: Uuid, version: i64) -> Work<State>;
    fn revisions(&self, p: Uuid) -> Work<Vec<Revision>>;
    fn blocks(
        &self,
        p: Uuid,
        revision: Option<Uuid>,
        query: String,
        offset: u32,
        ids: Option<Vec<Uuid>>,
    ) -> Work<Blocks>;
    fn create(&self, p: Uuid, key: Uuid, input: Generate) -> Work<Run>;
    fn command(&self, p: Uuid, id: Uuid, key: Uuid, expected: i64, action: String) -> Work<Run>;
    fn claim(&self) -> Work<Option<Run>>;
    fn heartbeat(&self, run: Run) -> Work<bool>;
    fn plan(&self, run: Run) -> Work<Option<Plan>>;
    fn checkpoint(
        &self,
        run: Run,
        batch: i64,
        result: serde_json::Value,
        request: Uuid,
    ) -> Work<()>;
    fn complete(&self, run: Run) -> Work<()>;
    fn fail(&self, run: Run, code: String) -> Work<()>;
}
#[derive(Clone)]
pub(crate) struct Outlines {
    store: Arc<dyn Store>,
    inference: crate::modules::inference::Inference,
}
impl Outlines {
    pub fn new(store: Arc<dyn Store>, inference: crate::modules::inference::Inference) -> Self {
        Self { store, inference }
    }
    pub async fn state(&self, p: Uuid, r: Option<Uuid>) -> Result<State, Error> {
        self.store.state(p, r).await
    }
    pub async fn save(&self, p: Uuid, e: Edit) -> Result<State, Error> {
        validation::draft(&e.draft)?;
        if e.expected_version < 0 || e.guide_version < 0 {
            return Err(Error::Invalid);
        }
        self.store.save(p, e).await
    }
    pub async fn confirm(&self, p: Uuid, v: i64) -> Result<State, Error> {
        self.store.confirm(p, v).await
    }
    pub async fn revisions(&self, p: Uuid) -> Result<Vec<Revision>, Error> {
        self.store.revisions(p).await
    }
    pub async fn blocks(
        &self,
        p: Uuid,
        r: Option<Uuid>,
        q: String,
        o: u32,
        ids: Option<Vec<Uuid>>,
    ) -> Result<Blocks, Error> {
        if q.chars().count() > 120 || o > 20000 || ids.as_ref().is_some_and(|v| v.len() > 20) {
            return Err(Error::Invalid);
        }
        self.store.blocks(p, r, q, o, ids).await
    }
    pub async fn create(&self, p: Uuid, k: Uuid, i: Generate) -> Result<Run, Error> {
        if !["generate", "map"].contains(&i.kind.as_str())
            || i.node_ids.len() > 24
            || i.expected_version < 0
            || i.model_version < 1
        {
            return Err(Error::Invalid);
        }
        self.store.create(p, k, i).await
    }
    pub async fn command(
        &self,
        p: Uuid,
        id: Uuid,
        key: Uuid,
        v: i64,
        a: String,
    ) -> Result<Run, Error> {
        if !["retry", "cancel"].contains(&a.as_str()) {
            return Err(Error::Invalid);
        }
        self.store.command(p, id, key, v, a).await
    }
}
pub(crate) fn validate_draft(d: &Draft) -> Result<(), Error> {
    validation::draft(d)
}
