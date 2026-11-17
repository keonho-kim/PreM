// Purpose: Atomically checkpoint edit stages under canonical leases and versioned definitions.
// Pattern: Proposals and previews retain their existing owners and approve/publish contract.
// Usage: Edit Driver, final target checkpoint and final rendered preview commit.
// Related: V28 migration, workflows.rs, targets.rs, render.rs.
use super::*;
use crate::adapters::sqlite::workflows as w;
use crate::workflows::{
    definitions::SLIDE_EDIT,
    engine::{Node, Stage},
};
fn id(e: Uuid) -> String {
    format!("edit:{e}")
}
fn error(e: w::Error) -> Error {
    match e {
        w::Error::Compatibility => Error::Processing("workflow_incompatible"),
        w::Error::Conflict => Error::Conflict,
        w::Error::Sql(e) => failure(e),
    }
}
pub(super) fn steps(db: &rusqlite::Connection, e: Uuid) -> Result<Vec<Stage>, Error> {
    w::stages(db, &id(e)).map_err(error)
}
pub(in crate::adapters::sqlite::presentations) fn begin(
    db: &mut rusqlite::Connection,
    e: Edit,
    n: Node,
) -> Result<bool, Error> {
    let tx = db.transaction().map_err(failure)?;
    active(&tx, &e)?;
    w::verify(&tx, &id(e.id), SLIDE_EDIT).map_err(error)?;
    let result = w::begin(
        &tx,
        &id(e.id),
        n,
        e.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(in crate::adapters::sqlite::presentations) fn finish(
    db: &mut rusqlite::Connection,
    e: Edit,
    n: Node,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    if n.key == "render" && get(&tx, e.project_id, &e.id.to_string())?.status == "ready" {
        return Ok(());
    }
    active(&tx, &e)?;
    stage(&tx, &e, n.key)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
fn stage(db: &rusqlite::Connection, e: &Edit, key: &str) -> Result<(), Error> {
    w::finish(
        db,
        &id(e.id),
        key,
        e.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)
}
pub(super) fn proposed(db: &rusqlite::Connection, e: &Edit) -> Result<(), Error> {
    let pending:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edit_targets WHERE edit_id=? AND proposed_spec_sha256 IS NULL)",[e.id.to_string()],|r|r.get(0)).map_err(failure)?;
    if !pending {
        stage(db, e, "propose")?;
    }
    Ok(())
}
pub(super) fn rendered(db: &rusqlite::Connection, e: &Edit) -> Result<(), Error> {
    stage(db, e, "render")
}
