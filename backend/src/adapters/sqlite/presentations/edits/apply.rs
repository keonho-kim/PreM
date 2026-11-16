// Purpose: Assemble a new presentation revision from one proposed slide and unchanged versions.
// Pattern: Explicit apply queues rendering, reuses untouched specs and fences the final head commit.
// Usage: Called only by the version-checked edit command inside its transaction.
// Related: publish.rs, presentation_run_slides, presentation_revision_slides.
use super::*;
pub(super) fn create(db: &rusqlite::Connection, e: &Edit) -> Result<(), Error> {
    let busy:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=? AND status IN('queued','running')) OR (SELECT count(*) FROM presentation_runs WHERE status IN('queued','running'))>=20",[e.project_id.to_string()],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    let spec = e.proposed_spec.as_ref().ok_or(Error::NotReady)?;
    let id = Uuid::new_v4().to_string();
    db.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at) SELECT ?,project_id,presentation_id,?,?,?,design_id,?,'',1,?,'queued','rendering',? FROM presentation_runs WHERE id=?",params![id,Uuid::new_v4().to_string(),format!("slide-edit:{}",e.id),e.base_version,e.config_id.to_string(),e.runtime_profile,now(),e.base_revision_id.to_string()]).map_err(failure)?;
    let rows=db.prepare("SELECT x.slide_version_id,x.position,s.node_id FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? ORDER BY x.position").map_err(failure)?.query_map([e.base_revision_id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for (old, position, node) in rows {
        let slide = if old == e.source_slide_id.to_string() {
            let slide = Uuid::new_v4().to_string();
            db.execute("INSERT INTO presentation_slide_versions(id,run_id,position,node_id,spec_sha256,request_id) SELECT ?,?,?,?, ?,request_id FROM presentation_edits WHERE id=?",params![slide,id,position,node,spec,e.id.to_string()]).map_err(failure)?;
            db.execute("INSERT INTO presentation_slide_evidence SELECT ?,block_id FROM presentation_slide_evidence WHERE slide_version_id=?",params![slide,old]).map_err(failure)?;
            slide
        } else {
            old
        };
        db.execute(
            "INSERT INTO presentation_run_slides VALUES(?,?,?)",
            params![id, slide, position],
        )
        .map_err(failure)?;
    }
    db.execute(
        "UPDATE presentation_edits SET applied_run_id=? WHERE id=?",
        params![id, e.id.to_string()],
    )
    .map_err(failure)?;
    Ok(())
}
