// Purpose: Read scoped chat threads and share narrow immutable-input checks across edit commands.
// Pattern: Presentation-owned rows, canonical spec hashes and explicit project/revision membership.
// Usage: Presentation SQLite adapter delegates proposal admission, leases and application here.
// Related: admission.rs, lifecycle.rs, apply.rs, V20 migration.
mod admission;
mod apply;
mod lifecycle;
use super::*;
pub(super) use admission::create;
pub(super) use lifecycle::{claim, command, context, fail, heartbeat, ready};
fn parse(s: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&s).map_err(|_| rusqlite::Error::InvalidQuery)
}
pub(super) fn get(db: &rusqlite::Connection, p: Uuid, id: &str) -> Result<Edit, Error> {
    preparation::project(db, p, false)?;
    db.query_row("SELECT e.id,e.project_id,e.presentation_id,e.base_revision_id,e.base_version,e.source_slide_id,e.prompt,e.fields_json,e.status,e.version,e.message,e.error_code,e.applied_run_id,r.status,e.created_at,e.config_id,e.lease,e.runtime_profile,s.spec_sha256,e.proposed_spec_sha256,c.connection_id FROM presentation_edits e JOIN presentation_slide_versions s ON s.id=e.source_slide_id JOIN llm_provider_config_versions c ON c.id=e.config_id LEFT JOIN presentation_runs r ON r.id=e.applied_run_id WHERE e.id=? AND e.project_id=?",params![id,p.to_string()],|r|Ok(Edit{id:parse(r.get(0)?)?,project_id:parse(r.get(1)?)?,presentation_id:parse(r.get(2)?)?,base_revision_id:parse(r.get(3)?)?,base_version:r.get(4)?,source_slide_id:parse(r.get(5)?)?,prompt:r.get(6)?,fields:serde_json::from_str(&r.get::<_,String>(7)?).map_err(|_|rusqlite::Error::InvalidQuery)?,status:r.get(8)?,version:r.get(9)?,message:r.get(10)?,error_code:r.get(11)?,applied_run_id:r.get::<_,Option<String>>(12)?.map(parse).transpose()?,render_status:r.get(13)?,created_at:r.get(14)?,config_id:parse(r.get(15)?)?,lease:r.get(16)?,runtime_profile:r.get(17)?,source_spec:r.get(18)?,proposed_spec:r.get(19)?,connection_id:parse(r.get(20)?)?})).optional().map_err(failure)?.ok_or(Error::NotFound)
}
pub(super) fn list(
    db: &rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    slide: Uuid,
) -> Result<Vec<Edit>, Error> {
    queries::run(db, p, &run.to_string())?;
    let (deck,node):(String,String)=db.query_row("SELECT r.presentation_id,s.node_id FROM presentation_runs r JOIN presentation_run_slides x ON x.run_id=r.id JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE r.id=? AND s.id=?",params![run.to_string(),slide.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?.ok_or(Error::NotFound)?;
    let mut ids=db.prepare("SELECT id FROM presentation_edits WHERE project_id=? AND presentation_id=? AND node_id=? ORDER BY created_at DESC,id DESC LIMIT 20").map_err(failure)?.query_map(params![p.to_string(),deck,node],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    ids.reverse();
    ids.iter().map(|id| get(db, p, id)).collect()
}
fn current(db: &rusqlite::Connection, e: &Edit) -> Result<(), Error> {
    let matches:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentations WHERE id=? AND project_id=? AND current_revision_id=? AND version=?)",params![e.presentation_id.to_string(),e.project_id.to_string(),e.base_revision_id.to_string(),e.base_version],|r|r.get(0)).map_err(failure)?;
    if !matches {
        return Err(Error::Conflict);
    }
    Ok(())
}
fn active(db: &rusqlite::Connection, e: &Edit) -> Result<(), Error> {
    let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edits e JOIN projects p ON p.id=e.project_id WHERE e.id=? AND e.status='running' AND e.lease=? AND e.lease_until>? AND p.status='active' AND p.deleted_at IS NULL)",params![e.id.to_string(),e.lease,now()],|r|r.get(0)).map_err(failure)?;
    if !valid {
        return Err(Error::Cancelled);
    }
    Ok(())
}
pub(super) fn is_edit(db: &rusqlite::Connection, id: &str) -> Result<bool, Error> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM presentation_edits WHERE applied_run_id=?)",
        [id],
        |r| r.get(0),
    )
    .map_err(failure)
}
pub(super) fn mark_applied(db: &rusqlite::Connection, id: &str) -> Result<(), Error> {
    db.execute("UPDATE presentation_edits SET status='applied',version=version+1 WHERE applied_run_id=? AND status='applying'",[id]).map_err(failure)?;
    Ok(())
}
