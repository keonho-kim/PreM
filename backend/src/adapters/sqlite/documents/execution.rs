// Purpose: Bridge canonical document jobs to versioned engine checkpoints and search readiness.
// Pattern: Lease-fenced short commits; parsing/OCR and model work never hold transactions.
// Usage: Document/template drivers, extraction commits and terminal publication.
// Related: V24 migration, workflows.rs, jobs.rs, results.rs.
use super::super::workflows as w;
use super::*;
use crate::workflows::{
    definitions::{DOCUMENT, TEMPLATE},
    engine::{Node, Stage},
};
fn error(e: w::Error) -> Error {
    match e {
        w::Error::Compatibility => Error::Processing("workflow_incompatible"),
        w::Error::Conflict => Error::Conflict,
        w::Error::Sql(e) => failure(e),
    }
}
fn id(j: Uuid) -> String {
    format!("document:{j}")
}
pub(super) fn steps(db: &rusqlite::Connection, j: Uuid) -> Result<Vec<Stage>, Error> {
    w::stages(db, &id(j)).map_err(error)
}
pub(super) fn begin(db: &mut rusqlite::Connection, j: Job, n: Node) -> Result<bool, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &j)?;
    let version: i64 = tx
        .query_row(
            "SELECT definition_version FROM document_jobs WHERE id=?",
            [j.id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if version != 1 {
        return Err(Error::Processing("workflow_incompatible"));
    }
    w::verify(
        &tx,
        &id(j.id),
        if j.kind == "templates" {
            TEMPLATE
        } else {
            DOCUMENT
        },
    )
    .map_err(error)?;
    let result = w::begin(
        &tx,
        &id(j.id),
        n,
        j.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn finish(db: &mut rusqlite::Connection, j: Job, n: Node) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    if n.key == "ready" && queries::get(&tx, j.id)?.status == "succeeded" {
        return Ok(());
    }
    queries::active(&tx, &j)?;
    w::finish(
        &tx,
        &id(j.id),
        n.key,
        j.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn extracted(db: &rusqlite::Connection, j: &Job) -> Result<(), Error> {
    let running:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM workflow_nodes WHERE workflow_id=? AND node_key='extract' AND state='running' AND lease=?)",params![id(j.id),j.lease],|r|r.get(0)).map_err(failure)?;
    if running {
        w::finish(
            db,
            &id(j.id),
            "extract",
            j.lease.as_deref().ok_or(Error::Cancelled)?,
            now(),
        )
        .map_err(error)?;
    }
    Ok(())
}
pub(super) fn publish(db: &rusqlite::Connection, j: &Job) -> Result<(), Error> {
    // Extraction/blocks/FTS are already atomic. Publication verifies all required results exist.
    let current = queries::get(db, j.id)?;
    if j.kind == "templates" {
        let ready:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM template_import_links WHERE job_id=?) OR EXISTS(SELECT 1 FROM template_extractions WHERE id=?)",params![j.id.to_string(),j.id.to_string()],|r|r.get(0)).map_err(failure)?;
        if !ready {
            return Err(Error::Storage);
        }
    } else {
        if current.extraction_id.is_none()
            || !queries::blocks(db, j.id, None, true, String::new(), 0)?.is_empty()
        {
            return Err(Error::Conflict);
        }
    }
    w::finish(
        db,
        &id(j.id),
        "ready",
        j.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)
}
pub(super) fn reset_running(db: &rusqlite::Connection, j: Uuid) -> Result<(), Error> {
    w::interrupt(db, &id(j), None, "pending", now()).map_err(error)
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute("INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT n.workflow_id,n.node_key,'recovered',? FROM workflow_nodes n JOIN document_workflows d ON d.workflow_id=n.workflow_id WHERE n.state='running'",[now()])?;
    db.execute("UPDATE workflow_nodes SET state='pending',lease=NULL WHERE state='running' AND workflow_id IN(SELECT workflow_id FROM document_workflows)",[])?;
    Ok(())
}
