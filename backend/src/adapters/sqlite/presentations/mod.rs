// Purpose: Implement the presentation persistence port on the serialized SQLite writer.
// Pattern: Preparation, admission, checkpoints and publication have cohesive private owners.
// Usage: App injects this adapter; no domain receives a database handle.
// Related: V19 migration, modules/presentations/.
mod admission;
mod canvas;
mod citations;
mod edits;
mod execution;
mod history;
mod jobs;
mod layers;
mod manual;
mod media;
mod models;
mod plans;
mod preparation;
mod publish;
mod quality;
mod queries;
mod reference_generation;
mod references;
mod scope;
mod sessions;
mod store;
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
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("DELETE FROM presentation_editor_sessions", [])?;
    let time = now();
    db.execute("INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT workflow_id,node_key,'recovered',? FROM workflow_nodes WHERE state='running' AND workflow_id IN(SELECT workflow_id FROM presentation_workflows)",[time])?;
    db.execute(
        "UPDATE workflow_nodes SET state='pending',lease=NULL WHERE state='running' AND workflow_id IN(SELECT workflow_id FROM presentation_workflows)",
        [],
    )?;
    db.execute("UPDATE presentation_runs SET status='queued',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running'",[])?;
    db.execute("UPDATE presentation_edits SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='interrupted',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running'",[])?;
    Ok(())
}
