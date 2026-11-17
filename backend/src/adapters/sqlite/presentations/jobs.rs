// Purpose: Own presentation job leases, explicit cancel/retry and checkpoint fencing.
// Pattern: Committed input snapshots survive restarts; no uncertain output is silently applied.
// Usage: One supervised presentation worker and HTTP commands.
// Related: admission.rs, plans.rs, queries.rs.
use super::*;
pub(super) fn active(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    let ok:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.lease=? AND r.lease_until>? AND r.status='running' AND p.deleted_at IS NULL AND p.status='active')",params![r.id.to_string(),r.lease,now()],|r|r.get(0)).map_err(failure)?;
    if !ok {
        return Err(Error::Cancelled);
    }
    Ok(())
}
pub(super) fn claim(db: &mut rusqlite::Connection) -> Result<Option<Run>, Error> {
    let tx = db.transaction().map_err(failure)?;
    tx.execute("UPDATE presentation_runs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,lease=NULL,lease_until=NULL,error_code='interrupted',version=version+1 WHERE status='running' AND lease_until<?",[now()]).map_err(failure)?;
    let row:Option<(String,String)>=tx.query_row("SELECT r.id,r.project_id FROM presentation_runs r JOIN projects p ON p.id=r.project_id WHERE r.status='queued' AND p.deleted_at IS NULL AND p.status='active' ORDER BY r.created_at,r.id LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let Some((id, p)) = row else {
        tx.commit().map_err(failure)?;
        return Ok(None);
    };
    super::super::workflows::interrupt(&tx, &id, None, "pending", now())
        .map_err(|_| Error::Storage)?;
    tx.execute("UPDATE presentation_runs SET status='running',lease=?,lease_until=?,attempt=attempt+1,version=version+1,error_code=NULL WHERE id=?",params![Uuid::new_v4().to_string(),now()+30000,id]).map_err(failure)?;
    let run = queries::run(&tx, uuid(p)?, &id)?;
    tx.commit().map_err(failure)?;
    Ok(Some(run))
}
pub(super) fn heartbeat(db: &mut rusqlite::Connection, r: Run) -> Result<bool, Error> {
    if active(db, &r).is_err() {
        return Ok(false);
    }
    Ok(db
        .execute(
            "UPDATE presentation_runs SET lease_until=? WHERE id=? AND lease=? AND status='running'",
            params![now() + 30000, r.id.to_string(), r.lease],
        )
        .map_err(failure)?
        == 1)
}
pub(super) fn fail(db: &mut rusqlite::Connection, r: Run, code: String) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    execution::interrupt(
        &tx,
        &r,
        if code == "interrupted" {
            "pending"
        } else {
            "failed"
        },
    )?;
    tx.execute("UPDATE presentation_runs SET status=CASE WHEN ?1='interrupted' AND attempt<3 THEN 'queued' ELSE 'failed' END,error_code=?1,lease=NULL,lease_until=NULL,version=version+1 WHERE id=?2 AND lease=?3 AND status='running'",params![code,r.id.to_string(),r.lease]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn command(
    db: &mut rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    key: Uuid,
    expected: i64,
    action: String,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    let old: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT run_id,expected_version,action FROM presentation_commands WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some(old) = old {
        if old != (id.to_string(), expected, action) {
            return Err(Error::Idempotency);
        }
        return queries::run(&tx, p, &id.to_string());
    }
    let r = queries::run(&tx, p, &id.to_string())?;
    if r.version != expected {
        return Err(Error::Conflict);
    }
    let status = match action.as_str() {
        "cancel" if ["queued", "running"].contains(&r.status.as_str()) => "cancelled",
        "retry" if ["failed", "cancelled"].contains(&r.status.as_str()) => "queued",
        _ => return Err(Error::Conflict),
    };
    if status == "queued" {
        let (base, design, deck): (i64, Option<String>, String) = tx
            .query_row(
                "SELECT base_version,design_id,presentation_id FROM presentation_runs WHERE id=?",
                [id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(failure)?;
        let current: i64 = tx
            .query_row(
                "SELECT version FROM presentations WHERE id=?",
                [deck],
                |r| r.get(0),
            )
            .map_err(failure)?;
        if current != base
            || (!canvas::authored(&tx, &id.to_string())?
                && !edits::is_edit(&tx, &id.to_string())?
                && preparation::current(&tx, p)?.design_id != design.map(uuid).transpose()?)
        {
            return Err(Error::Conflict);
        }
        let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=? AND id!=? AND status IN('queued','running'))",params![p.to_string(),id.to_string()],|r|r.get(0)).map_err(failure)?;
        if busy {
            return Err(Error::Busy);
        }
    }
    if status == "cancelled" {
        execution::interrupt(&tx, &r, "cancelled")?;
    }
    tx.execute(
        "INSERT INTO presentation_commands VALUES(?,?,?,?)",
        params![key.to_string(), id.to_string(), expected, action],
    )
    .map_err(failure)?;
    tx.execute("UPDATE presentation_runs SET status=?,lease=NULL,lease_until=NULL,version=version+1,error_code=NULL WHERE id=?",params![status,id.to_string()]).map_err(failure)?;
    let r = queries::run(&tx, p, &id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(r)
}
