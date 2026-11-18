// Purpose: Define document-owned persistence and extraction contracts.
// Pattern: Atomic checkpoints reject stale leases and keep long work outside transactions.
// Usage: SQLite implements Store; process/HTML extraction implements Extractor.
// Related: types.rs, worker.rs, adapters/sqlite/documents/.
use super::*;
use std::{future::Future, pin::Pin};
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn alignment_checkpoints(
        &self,
        job: Uuid,
    ) -> Work<std::collections::HashMap<String, serde_json::Value>>;
    fn save_alignment(
        &self,
        job: Job,
        key: String,
        result: serde_json::Value,
        request: Uuid,
    ) -> Work<()>;
    fn publish_alignment(
        &self,
        job: Job,
        entries: Vec<SourceEntry>,
        pages: Vec<(Uuid, PageAlignment)>,
    ) -> Work<()>;
    fn current_job(&self, id: Uuid) -> Work<Job>;
    fn begin_node(&self, j: Job, n: crate::workflows::engine::Node) -> Work<bool>;
    fn finish_node(&self, j: Job, n: crate::workflows::engine::Node) -> Work<()>;

    fn enqueue(
        &self,
        kind: String,
        item: Uuid,
        expected: i64,
        key: Uuid,
        profile: ExtractionProfiles,
    ) -> Work<Job>;
    fn scan_uploads(&self, profile: ExtractionProfiles) -> Work<()>;
    fn claim(&self) -> Work<Option<Job>>;
    fn heartbeat(&self, id: Uuid, lease: String) -> Work<bool>;
    fn restore_extraction(&self, job: Job) -> Work<Option<Uuid>>;
    fn extraction(&self, job: Job, result: Extracted) -> Work<Uuid>;
    fn pin(&self, job: Job) -> Work<Job>;
    fn blocks(
        &self,
        job: Uuid,
        page: Option<Uuid>,
        pending: bool,
        query: String,
        offset: u32,
    ) -> Work<Vec<Block>>;
    fn decisions(&self, job: Job, values: Vec<DecisionCommit>) -> Work<()>;
    fn finish(&self, job: Job, status: String, error: Option<String>, retry: bool) -> Work<()>;
    fn detail(&self, kind: String, item: Uuid, job: Option<Uuid>) -> Work<Detail>;
    fn history(&self, kind: String, item: Uuid, file_version: Option<i64>) -> Work<Vec<Job>>;
    fn command(&self, id: Uuid, expected: i64, key: Uuid, action: String) -> Work<Job>;
    fn artifact(&self, job: Uuid, hash: String) -> Work<(String, u64)>;
    fn materials(
        &self,
        job: Uuid,
        page: Option<Uuid>,
        kind: String,
        query: String,
        offset: u32,
        selection: Option<Vec<Uuid>>,
    ) -> Work<MaterialCatalog>;
    fn settings(&self) -> Work<Settings>;
    fn save_settings(&self, expected: i64, connection: Option<Uuid>) -> Work<Settings>;
}
pub(crate) trait Extractor: Send + Sync {
    fn profile(&self) -> ExtractionProfiles;
    fn extract(&self, job: Job, stop: tokio_util::sync::CancellationToken) -> Work<Extracted>;
}
