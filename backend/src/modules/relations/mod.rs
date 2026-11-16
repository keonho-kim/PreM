// Purpose: Own cross-project retrieval, typed relation decisions and pinned source selections.
// Pattern: Durable runs with a consumer-owned store; Decisions owns model transport/admission.
// Usage: Studio and Admin call this facade; Application owns its worker lifetime.
// Related: worker.rs, protocol.rs, adapters/sqlite/relations/.
mod exploration;
mod protocol;
mod types;
pub(crate) use protocol::{clip as clip_text, hash as input_hash};
mod worker;
use crate::modules::decisions::Decisions;
use std::{future::Future, pin::Pin, sync::Arc};
pub(crate) use types::*;
use uuid::Uuid;
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn advance(&self, run: Run) -> Work<Next>;
    fn pull(&self, run: Run, queries: Vec<String>, request: Option<Uuid>) -> Work<()>;
    fn evidence(&self, project: Uuid, candidate: Uuid) -> Work<Vec<EvidenceRead>>;
    fn create(&self, project: Uuid, key: Uuid, input: Search) -> Work<Run>;
    fn get(&self, project: Uuid, id: Option<Uuid>) -> Work<Option<Run>>;
    fn results(&self, project: Uuid, id: Uuid, kind: String, offset: u32) -> Work<Results>;
    fn origins(&self, project: Uuid, candidate: Uuid, offset: u32) -> Work<Vec<Origin>>;
    fn command(
        &self,
        project: Uuid,
        id: Uuid,
        expected: i64,
        key: Uuid,
        action: String,
    ) -> Work<Run>;
    fn settings(&self, edit: Option<Settings>) -> Work<Settings>;
    fn select(&self, project: Uuid, input: SelectItem) -> Work<Selection>;
    fn selections(&self, project: Uuid) -> Work<Results>;
    fn claim(&self) -> Work<Option<Run>>;
    fn heartbeat(&self, run: Run) -> Work<bool>;
    fn plan(&self, run: Run) -> Work<Plan>;
    fn cached(&self, run: Run, keys: Vec<(Uuid, String)>) -> Work<Vec<Uuid>>;
    fn commit(&self, run: Run, values: Vec<Assessment>) -> Work<()>;
    fn finish(&self, run: Run, status: String, error: Option<String>) -> Work<()>;
}
#[derive(Clone)]
pub(crate) struct Relations {
    store: Arc<dyn Store>,
    decisions: Decisions,
    inference: crate::modules::inference::Inference,
}
impl Relations {
    pub fn new(
        store: Arc<dyn Store>,
        decisions: Decisions,
        inference: crate::modules::inference::Inference,
    ) -> Self {
        Self {
            store,
            decisions,
            inference,
        }
    }
    pub async fn evidence(
        &self,
        project: Uuid,
        candidate: Uuid,
    ) -> Result<Vec<EvidenceRead>, Error> {
        self.store.evidence(project, candidate).await
    }
    pub async fn create(&self, p: Uuid, key: Uuid, mut input: Search) -> Result<Run, Error> {
        input.query = input.query.trim().into();
        if input.query.chars().count() > 120
            || input.options.source_project == Some(p)
            || input.options.since.is_some_and(|t| t < 0 || t > now())
            || input.options.format.as_deref().is_some_and(|f| {
                !["pdf", "hwp", "hwpx", "docx", "pptx", "xlsx", "html", "md"].contains(&f)
            })
        {
            return Err(Error::Invalid);
        }
        self.store.create(p, key, input).await
    }
    pub async fn get(&self, p: Uuid, id: Option<Uuid>) -> Result<Option<Run>, Error> {
        self.store.get(p, id).await
    }
    pub async fn results(
        &self,
        p: Uuid,
        id: Uuid,
        kind: String,
        offset: u32,
    ) -> Result<Results, Error> {
        if !["file", "block"].contains(&kind.as_str()) || offset > 1000 {
            return Err(Error::Invalid);
        }
        self.store.results(p, id, kind, offset).await
    }
    pub async fn origins(&self, p: Uuid, id: Uuid, offset: u32) -> Result<Vec<Origin>, Error> {
        if offset > 100000 {
            return Err(Error::Invalid);
        }
        self.store.origins(p, id, offset).await
    }
    pub async fn command(
        &self,
        p: Uuid,
        id: Uuid,
        expected: i64,
        key: Uuid,
        action: String,
    ) -> Result<Run, Error> {
        if !["retry", "cancel"].contains(&action.as_str()) || expected < 1 {
            return Err(Error::Invalid);
        }
        self.store.command(p, id, expected, key, action).await
    }
    pub async fn settings(&self, edit: Option<Settings>) -> Result<Settings, Error> {
        self.store.settings(edit).await
    }
    pub async fn select(&self, p: Uuid, input: SelectItem) -> Result<Selection, Error> {
        if input.expected_version < 0 || input.expected_version.checked_add(1).is_none() {
            return Err(Error::Invalid);
        }
        self.store.select(p, input).await
    }
    pub async fn selections(&self, p: Uuid) -> Result<Results, Error> {
        self.store.selections(p).await
    }
}
