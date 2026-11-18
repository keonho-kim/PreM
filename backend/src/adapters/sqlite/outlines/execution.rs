// Purpose: Fence common outline checkpoints with canonical job leases and atomic revision commits.
// Pattern: Feature-owned bridge delegates generic writes; no second job or batch-output owner.
// Usage: Engine driver, final batch checkpoint and publication transaction.
// Related: jobs.rs, plans.rs, queries.rs, V1__baseline.sql.
use super::super::workflows as w;
use super::*;
use crate::workflows::{
    definitions::{MAPPING, OUTLINE},
    engine::{Node as EngineNode, Stage},
};
fn error(e: w::Error) -> Error {
    match e {
        w::Error::Compatibility => Error::Model("workflow_incompatible"),
        w::Error::Conflict => Error::Conflict,
        w::Error::Sql(e) => failure(e),
    }
}
fn id(r: Uuid) -> String {
    format!("outline:{r}")
}
pub(super) fn steps(db: &rusqlite::Connection, r: Uuid) -> Result<Vec<Stage>, Error> {
    w::stages(db, &id(r)).map_err(error)
}
pub(super) fn begin(db: &mut rusqlite::Connection, r: Run, n: EngineNode) -> Result<bool, Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    w::verify(
        &tx,
        &id(r.id),
        if r.kind == "map" { MAPPING } else { OUTLINE },
    )
    .map_err(error)?;
    let result = w::begin(
        &tx,
        &id(r.id),
        n,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn finish(db: &mut rusqlite::Connection, r: Run, n: EngineNode) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    if n.key == "publish"
        && queries::run(&tx, r.project_id, &r.id.to_string())?.status == "succeeded"
    {
        return Ok(());
    }
    jobs::active(&tx, &r)?;
    finish_stage(&tx, &r, n.key)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
fn finish_stage(db: &rusqlite::Connection, r: &Run, key: &str) -> Result<(), Error> {
    w::finish(
        db,
        &id(r.id),
        key,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)
}
pub(super) fn checkpoint(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    let remaining: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM outline_run_batches WHERE run_id=? AND response_json IS NULL)", [r.id.to_string()], |row| row.get(0)).map_err(failure)?;
    if !remaining {
        finish_stage(db, r, if r.kind == "map" { "map" } else { "compose" })?;
    }
    Ok(())
}
pub(super) fn publish(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    finish_stage(db, r, "publish")
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT n.workflow_id,n.node_key,'recovered',? FROM workflow_nodes n JOIN outline_workflows o ON o.workflow_id=n.workflow_id WHERE n.state='running'", [now()])?;
    // Canonical status transitions reset/fail the associated running node through the trigger.
    db.execute("UPDATE outline_runs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='interrupted',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running'",[])?;
    Ok(())
}
