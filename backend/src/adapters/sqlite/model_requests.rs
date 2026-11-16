// Purpose: Persist sanitized model request history without prompts, outputs or credentials.
// Pattern: One write owner for llm_requests and config-version lineage.
// Usage: Shared model execution starts and finalizes records around external work.
// Related: modules/model_execution/, V5__model_registry.sql.
use super::{Queue, Unavailable};
use crate::modules::model_execution::{
    CallFuture, Capacity, Error, Limits, RequestRecord, RequestStore,
};
use rusqlite::params;
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteRequests(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"request history failed");
    Error::Storage
}
impl RequestStore for SqliteRequests {
    fn capacity(&self, id: Uuid) -> CallFuture<Capacity> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| super::model_capacity::get(db, id)).await })
    }
    fn save_capacity(&self, id: Uuid, expected: i64, limits: Limits) -> CallFuture<Capacity> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| super::model_capacity::save(db, id, expected, limits))
                .await
        })
    }

    fn start(&self, r: RequestRecord) -> CallFuture<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{db.execute("INSERT INTO llm_requests(id,provider_config_version_id,kind,status,created_at) VALUES (?,?,?,?,?)",params![r.id.to_string(),r.config_id.to_string(),r.kind,r.status,r.created_at]).map_err(failure)?;Ok(())}).await
        })
    }
    fn finish(&self, r: RequestRecord) -> CallFuture<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{db.execute("UPDATE llm_requests SET status=?,elapsed_ms=?,prompt_tokens=?,completion_tokens=?,error_code=? WHERE id=? AND status='running'",params![r.status,r.elapsed_ms,r.prompt_tokens,r.completion_tokens,r.error_code,r.id.to_string()]).map_err(failure)?;Ok(())}).await
        })
    }
    fn list(&self, id: Uuid) -> CallFuture<Vec<RequestRecord>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db| {
  db.prepare("SELECT r.id,r.provider_config_version_id,r.kind,r.status,r.elapsed_ms,r.prompt_tokens,r.completion_tokens,r.error_code,r.created_at FROM llm_requests r JOIN llm_provider_config_versions c ON c.id=r.provider_config_version_id WHERE c.connection_id=? ORDER BY r.created_at DESC,r.id LIMIT 20").map_err(failure)?.query_map([id.to_string()],|r|{
   let uuid=|i|{let s:String=r.get(i)?;Uuid::parse_str(&s).map_err(|_|rusqlite::Error::InvalidQuery)};
   Ok(RequestRecord{id:uuid(0)?,config_id:uuid(1)?,kind:r.get(2)?,status:r.get(3)?,elapsed_ms:r.get(4)?,prompt_tokens:r.get(5)?,completion_tokens:r.get(6)?,error_code:r.get(7)?,created_at:r.get(8)?})
  }).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
 }).await
        })
    }
}

pub(super) fn recover_interrupted(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("UPDATE llm_requests SET status='interrupted',error_code='server_restarted' WHERE status='running'",[])?;
    Ok(())
}
