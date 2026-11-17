// Purpose: Lease editing requests, retain source context and checkpoint validated proposals.
// Pattern: Short writer transactions, heartbeat fencing and reusable proposal artifacts.
// Usage: Presentation worker and explicit version-checked chat commands.
// Related: admission.rs, apply.rs, modules/presentations/edits.rs.
use super::*;
use serde_json::json;
pub(in crate::adapters::sqlite::presentations) fn claim(
    db: &mut rusqlite::Connection,
) -> Result<Option<Edit>, Error> {
    let tx = db.transaction().map_err(failure)?;
    tx.execute("UPDATE presentation_edits SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease=NULL,lease_until=NULL,error_code='interrupted' WHERE status='running' AND lease_until<?",[now()]).map_err(failure)?;
    let row:Option<(String,String)>=tx.query_row("SELECT e.id,e.project_id FROM presentation_edits e JOIN projects p ON p.id=e.project_id WHERE e.status='queued' AND p.status='active' AND p.deleted_at IS NULL ORDER BY e.created_at,e.id LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let Some((id, p)) = row else { return Ok(None) };
    tx.execute("UPDATE presentation_edits SET status='running',version=version+1,attempt=attempt+1,lease=?,lease_until=?,error_code=NULL WHERE id=?",params![Uuid::new_v4().to_string(),now()+30000,id]).map_err(failure)?;
    let result = get(&tx, uuid(p)?, &id)?;
    tx.commit().map_err(failure)?;
    Ok(Some(result))
}
pub(in crate::adapters::sqlite::presentations) fn heartbeat(
    db: &mut rusqlite::Connection,
    e: Edit,
) -> Result<bool, Error> {
    if active(db, &e).is_err() {
        return Ok(false);
    }
    Ok(db
        .execute(
            "UPDATE presentation_edits SET lease_until=? WHERE id=? AND lease=?",
            params![now() + 30000, e.id.to_string(), e.lease],
        )
        .map_err(failure)?
        == 1)
}
pub(in crate::adapters::sqlite::presentations) fn context(
    db: &mut rusqlite::Connection,
    e: Edit,
) -> Result<serde_json::Value, Error> {
    active(db, &e)?;
    let sources =
        super::super::citations::read(db, e.project_id, e.base_revision_id, e.source_slide_id)?
            .into_iter()
            .map(|c| json!({"id":c.block_id,"text":c.text}))
            .collect::<Vec<_>>();
    let history=db.prepare("SELECT e.prompt,e.message FROM presentation_edits e JOIN presentation_slide_versions s ON s.id=e.source_slide_id WHERE e.project_id=?1 AND e.presentation_id=?2 AND s.slide_key=(SELECT s2.slide_key FROM presentation_edits e2 JOIN presentation_slide_versions s2 ON s2.id=e2.source_slide_id WHERE e2.id=?3) AND e.status='applied' ORDER BY e.created_at DESC,e.id DESC LIMIT 3").map_err(failure)?.query_map(params![e.project_id.to_string(),e.presentation_id.to_string(),e.id.to_string()],|r|Ok(json!({"user":r.get::<_,String>(0)?,"assistant":r.get::<_,Option<String>>(1)?}))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    Ok(
        json!({"source_excerpts":sources,"available_references":e.references.iter().map(|m|json!({"reference_id":m.id,"title":m.title,"kind":m.kind,"text":m.text.as_deref().unwrap_or("")})).collect::<Vec<_>>(),"previous_applied_requests":history.into_iter().rev().collect::<Vec<_>>()}),
    )
}
pub(in crate::adapters::sqlite::presentations) fn fail(
    db: &mut rusqlite::Connection,
    e: Edit,
    code: String,
) -> Result<(), Error> {
    db.execute("UPDATE presentation_edits SET status=CASE WHEN ?='interrupted' AND attempt<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease=NULL,lease_until=NULL,error_code=? WHERE id=? AND status='running' AND lease=?",params![code,code,e.id.to_string(),e.lease]).map_err(failure)?;
    Ok(())
}
pub(in crate::adapters::sqlite::presentations) fn command(
    db: &mut rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    key: Uuid,
    version: i64,
    action: String,
    session: Option<Uuid>,
) -> Result<Edit, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    if let Some(old)=tx.query_row("SELECT edit_id,expected_version,action FROM presentation_edit_commands WHERE request_key=?",[key.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).optional().map_err(failure)?{if old!=(id.to_string(),version,action){return Err(Error::Idempotency)}return get(&tx,p,&id.to_string())}
    let e = get(&tx, p, &id.to_string())?;
    if e.version != version {
        return Err(Error::Conflict);
    }
    let status = match action.as_str() {
        "cancel" if ["queued", "running"].contains(&e.status.as_str()) => "cancelled",
        "reject" if e.status == "ready" => "rejected",
        "retry" if ["failed", "cancelled"].contains(&e.status.as_str()) => {
            current(&tx, &e)?;
            "queued"
        }
        "apply" if e.status == "ready" => {
            current(&tx, &e)?;
            apply::create(&tx, &e, session)?;
            "applying"
        }
        _ => return Err(Error::Conflict),
    };
    if status == "queued" {
        let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edits WHERE presentation_id=? AND id!=? AND (status IN('queued','running') OR (status='applying' AND applied_run_id IN(SELECT id FROM presentation_runs WHERE status IN('queued','running')))))",params![e.presentation_id.to_string(),id.to_string()],|r|r.get(0)).map_err(failure)?;
        if busy {
            return Err(Error::Busy);
        }
    }
    tx.execute(
        "INSERT INTO presentation_edit_commands VALUES(?,?,?,?)",
        params![key.to_string(), id.to_string(), version, action],
    )
    .map_err(failure)?;
    tx.execute("UPDATE presentation_edits SET status=?,version=version+1,lease=NULL,lease_until=NULL,error_code=NULL WHERE id=?",params![status,id.to_string()]).map_err(failure)?;
    let result = get(&tx, p, &id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
