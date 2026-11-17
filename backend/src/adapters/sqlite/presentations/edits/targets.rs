// Purpose: Freeze batch membership and independently checkpoint each validated slide proposal.
// Pattern: Canonical source versions, explicit object allowlists and lease-fenced atomic readiness.
// Usage: Admission and edit worker; retries reuse completed target specs.
// Related: apply.rs, V21 migration, modules/presentations/edits.rs.
use super::*;
pub(super) fn admit(
    db: &rusqlite::Connection,
    id: Uuid,
    run: Uuid,
    anchor: Uuid,
    slides: &[Uuid],
    objects: &[String],
) -> Result<(), Error> {
    let chosen = if slides.is_empty() {
        vec![anchor]
    } else {
        slides.to_vec()
    };
    if !chosen.contains(&anchor) || chosen.len() > 24 || (chosen.len() > 1 && !objects.is_empty()) {
        return Err(Error::EditInvalid);
    }
    for slide in chosen {
        let pos:Option<i64>=db.query_row("SELECT position FROM presentation_run_slides WHERE run_id=? AND slide_version_id=?",params![run.to_string(),slide.to_string()],|r|r.get(0)).optional().map_err(failure)?;
        let pos = pos.ok_or(Error::NotFound)?;
        db.execute("INSERT INTO presentation_edit_targets(edit_id,source_slide_id,position,object_ids_json) VALUES(?,?,?,?)",params![id.to_string(),slide.to_string(),pos,serde_json::to_string(objects).map_err(|_|Error::Storage)?]).map_err(failure)?;
    }
    Ok(())
}
pub(super) fn list(db: &rusqlite::Connection, e: &Edit) -> Result<Vec<EditTarget>, Error> {
    db.prepare("SELECT t.source_slide_id,t.position,t.object_ids_json,s.spec_sha256,t.proposed_spec_sha256 FROM presentation_edit_targets t JOIN presentation_slide_versions s ON s.id=t.source_slide_id WHERE t.edit_id=? ORDER BY t.position").map_err(failure)?.query_map([e.id.to_string()],|r|{let proposed_spec:Option<String>=r.get(4)?;Ok(EditTarget{slide_id:parse(r.get(0)?)?,position:r.get(1)?,object_ids:serde_json::from_str(&r.get::<_,String>(2)?).map_err(|_|rusqlite::Error::InvalidQuery)?,source_spec:r.get(3)?,completed:proposed_spec.is_some(),proposed_spec})}).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
}
pub(in crate::adapters::sqlite::presentations) fn ready(
    db: &mut rusqlite::Connection,
    e: Edit,
    target: Uuid,
    blob: DerivedBlob,
    message: String,
    request: Uuid,
    assets: UsedAssets,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    active(&tx, &e)?;
    super::super::plans::blob(&tx, &blob, "application/json", "json")?;
    if tx.execute("UPDATE presentation_edit_targets SET proposed_spec_sha256=?,message=?,request_id=? WHERE edit_id=? AND source_slide_id=? AND proposed_spec_sha256 IS NULL",params![blob.sha256,message,request.to_string(),e.id.to_string(),target.to_string()]).map_err(failure)?!=1{return Err(Error::Conflict)}
    for m in assets.media {
        let allowed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edit_media WHERE edit_id=? AND media_id=?)",params![e.id.to_string(),m.to_string()],|r|r.get(0)).map_err(failure)?;
        if !allowed {
            return Err(Error::EditInvalid);
        }
        tx.execute(
            "INSERT OR IGNORE INTO presentation_edit_target_media VALUES(?,?,?)",
            params![e.id.to_string(), target.to_string(), m.to_string()],
        )
        .map_err(failure)?;
    }
    for reference in assets.references {
        let allowed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_edit_imports WHERE edit_id=? AND import_id=?)",params![e.id.to_string(),reference.to_string()],|r|r.get(0)).map_err(failure)?;
        if !allowed {
            return Err(Error::EditInvalid);
        }
        tx.execute(
            "INSERT OR IGNORE INTO presentation_edit_target_imports VALUES(?,?,?)",
            params![e.id.to_string(), target.to_string(), reference.to_string()],
        )
        .map_err(failure)?;
    }
    tx.execute("UPDATE presentation_edits SET version=version+1,proposed_spec_sha256=CASE WHEN source_slide_id=? THEN ? ELSE proposed_spec_sha256 END,request_id=?,message=? WHERE id=?",params![target.to_string(),blob.sha256,request.to_string(),message,e.id.to_string()]).map_err(failure)?;
    execution::proposed(&tx, &e)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
