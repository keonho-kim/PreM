// Purpose: Persist source review snapshots without copying text or generated results.
// Pattern: One transaction verifies current versions/readiness and records immutable review links.
// Usage: The Studio facade requests state or confirms the supplied snapshot hash.
// Related: V1__baseline.sql, modules/studio/, documents/queries.rs.
use super::{Queue, Unavailable};
use crate::modules::studio::*;
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteStudio(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"source review failed");
    Error::Storage
}
impl Store for SqliteStudio {
    fn state(&self, id: Uuid, confirm: Option<String>) -> Work<State> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{
 let tx=db.transaction().map_err(failure)?;
 let status:Option<String>=tx.query_row("SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",[id.to_string()],|r|r.get(0)).optional().map_err(failure)?;
 let status=status.ok_or(Error::NotFound)?;
 let source=super::source_snapshot::read(&tx,&id.to_string()).map_err(failure)?;
 let snapshot=source.hash;let ready=source.ready;let rows=source.files;
 if let Some(expected)=confirm {
 if expected!=snapshot||status!="active" {return Err(Error::Conflict)}
 if !ready {return Err(Error::NotReady)}
 let review=Uuid::new_v4().to_string();
 let n=tx.execute("INSERT OR IGNORE INTO project_source_reviews VALUES(?,?,?,?)",params![review,id.to_string(),snapshot,crate::modules::libraries::now().map_err(|_|Error::Storage)?]).map_err(failure)?;
 if n==1 {for (version,extraction) in &rows {tx.execute("INSERT INTO project_source_review_files VALUES(?,?,?)",params![review,version,extraction]).map_err(failure)?;}}
 }
 let confirmed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM project_source_reviews WHERE project_id=? AND snapshot_hash=?)",params![id.to_string(),snapshot],|r|r.get(0)).map_err(failure)?;
 tx.commit().map_err(failure)?;
 Ok(State{snapshot,ready,confirmed:confirmed&&ready,count:rows.len()})
 }).await
        })
    }
}
