// Purpose: Fence search checkpoints and publication with the canonical relation lease.
// Pattern: No duplicate mutable run state; partial budget outcomes preserve completed assessments.
// Usage: Common-engine Driver and empty admission fast path.
// Related: lifecycle.rs, exploration.rs, workflows.rs, V26 migration.
use super::super::workflows as w;
use super::*;
use crate::workflows::{
    definitions::RELATION,
    engine::{Node, Stage},
};
fn error(e: w::Error) -> Error {
    match e {
        w::Error::Compatibility => Error::Model("workflow_incompatible"),
        w::Error::Conflict => Error::Conflict,
        w::Error::Sql(e) => failure(e),
    }
}
fn id(r: Uuid) -> String {
    format!("relation:{r}")
}
pub(super) fn steps(db: &rusqlite::Connection, r: Uuid) -> Result<Vec<Stage>, Error> {
    w::stages(db, &id(r)).map_err(error)
}
pub(super) fn begin(db: &mut rusqlite::Connection, r: Run, n: Node) -> Result<bool, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &r)?;
    w::verify(&tx, &id(r.id), RELATION).map_err(error)?;
    let value = w::begin(
        &tx,
        &id(r.id),
        n,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(value)
}
pub(super) fn finish(db: &mut rusqlite::Connection, r: Run, n: Node) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    if n.key == "publish"
        && queries::get(&tx, r.project_id, Some(r.id))?.is_some_and(|r| r.status == "succeeded")
    {
        return Ok(());
    }
    queries::active(&tx, &r)?;
    stage(&tx, &r, n.key)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
fn stage(db: &rusqlite::Connection, r: &Run, key: &str) -> Result<(), Error> {
    w::finish(
        db,
        &id(r.id),
        key,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)
}
pub(super) fn reviewed(db: &mut rusqlite::Connection, r: Run, budget: bool) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &r)?;
    if budget {
        exploration::end(&tx, &r, "budget")?;
    }
    stage(&tx, &r, "review")?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn publish(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    stage(db, r, "publish")
}
pub(super) fn empty(db: &rusqlite::Connection, r: Uuid) -> Result<(), Error> {
    // Candidate collection and the no-results decision are in this same admission transaction.
    db.execute(
        "UPDATE workflow_nodes SET state='succeeded' WHERE workflow_id=?",
        [id(r)],
    )
    .map_err(failure)?;
    Ok(())
}
