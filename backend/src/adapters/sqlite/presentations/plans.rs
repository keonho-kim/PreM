// Purpose: Build bounded slide contexts and commit validated specs with canonical citations.
// Pattern: Query source text transiently; retain only Blob and immutable block references.
// Usage: One pending slide per model request, resumable after failure or restart.
// Related: preparation.rs, publish.rs, modules/presentations/model.rs.
use super::*;
use serde_json::json;
pub(super) fn next(db: &mut rusqlite::Connection, r: Run) -> Result<Option<Plan>, Error> {
    jobs::active(db, &r)?;
    let row:Option<(String,String,String,String)>=db.query_row("SELECT s.id,s.node_id,v.title,v.description FROM presentation_slide_versions s JOIN presentation_runs r ON r.id=s.run_id JOIN presentation_designs d ON d.id=r.design_id JOIN presentation_evidence_reviews e ON e.id=d.evidence_review_id JOIN outline_revision_nodes n ON n.revision_id=e.outline_revision_id AND n.node_id=s.node_id JOIN outline_node_versions v ON v.id=n.node_version_id WHERE s.run_id=? AND s.spec_sha256 IS NULL ORDER BY s.position LIMIT 1",[r.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(failure)?;
    let Some((slide, node, title, description)) = row else {
        return Ok(None);
    };
    let (outline,review,do_text,dont_text,instructions):(String,String,String,String,String)=db.query_row("SELECT e.outline_revision_id,e.id,coalesce(g.do_text,''),coalesce(g.dont_text,''),r.instructions FROM presentation_runs r JOIN presentation_designs d ON d.id=r.design_id JOIN presentation_evidence_reviews e ON e.id=d.evidence_review_id JOIN outline_revisions o ON o.id=e.outline_revision_id LEFT JOIN project_guide_revisions g ON g.id=o.guide_revision_id WHERE r.id=?",[r.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(failure)?;
    let rows=db.prepare("WITH source_ids AS(SELECT block_id FROM outline_assignments WHERE revision_id=?1 AND node_id=?2 ORDER BY block_id LIMIT 12), evidence_ids AS(SELECT c.excerpt_block_id AS block_id FROM presentation_evidence_links e JOIN relation_link_changes l ON l.selection_id=e.selection_id AND l.version=e.selection_version JOIN relation_candidates c ON c.id=l.candidate_id WHERE e.review_id=?3), combined AS(SELECT block_id,0 AS priority FROM source_ids UNION SELECT block_id,1 FROM evidence_ids) SELECT b.id,b.text,min(s.priority) FROM combined s JOIN content_blocks b ON b.id=s.block_id GROUP BY b.id ORDER BY min(s.priority),b.id").map_err(failure)?.query_map(params![outline,node,review],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    if rows.is_empty() {
        return Err(Error::NotReady);
    }
    let mut blocks = vec![];
    let mut texts = vec![];
    for (id, text, _priority) in rows {
        blocks.push(uuid(id.clone())?);
        texts.push(json!({"id":id,"text":text}));
    }
    let deck_outline = db.prepare("SELECT v.title FROM outline_revision_nodes n JOIN outline_node_versions v ON v.id=n.node_version_id WHERE n.revision_id=? ORDER BY n.position").map_err(failure)?.query_map([&outline], |r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let context = json!({"task":"presentation_slide","presentation_title":r.title,"section":{"title":title,"description":description},"direction":{"do":do_text,"dont":dont_text},"additional_request":instructions,"sources":texts,"deck_outline":deck_outline});
    Ok(Some(Plan {
        first: db
            .query_row(
                "SELECT position=1 FROM presentation_slide_versions WHERE id=?",
                [&slide],
                |r| r.get(0),
            )
            .map_err(failure)?,
        layouts: vec![],
        materials: vec![],
        slide_id: uuid(slide)?,
        context,
        block_ids: blocks,
    }))
}
pub(super) fn blob(
    db: &rusqlite::Connection,
    b: &crate::modules::assets::DerivedBlob,
    mime: &str,
    format: &str,
) -> Result<(), Error> {
    if b.sha256.len() != 64
        || !b.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        || b.size == 0
        || b.size > 50 * 1024 * 1024
    {
        return Err(Error::Storage);
    }
    db.execute(
        "INSERT OR IGNORE INTO file_blobs VALUES(?,?,?,?,?)",
        params![b.sha256, b.size as i64, mime, format, now()],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn checkpoint(
    db: &mut rusqlite::Connection,
    r: Run,
    slide: Uuid,
    spec: crate::modules::assets::DerivedBlob,
    blocks: Vec<Uuid>,
    request: Uuid,
    references: Vec<Uuid>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    blob(&tx, &spec, "application/json", "json")?;
    if tx.execute("UPDATE presentation_slide_versions SET spec_sha256=?,request_id=? WHERE id=? AND run_id=? AND spec_sha256 IS NULL",params![spec.sha256,request.to_string(),slide.to_string(),r.id.to_string()]).map_err(failure)?!=1{return Err(Error::Conflict)}
    for reference in references {
        let allowed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_generation_imports WHERE run_id=? AND import_id=?)",params![r.id.to_string(),reference.to_string()],|r|r.get(0)).map_err(failure)?;
        if !allowed {
            return Err(Error::Conflict);
        }
        tx.execute(
            "INSERT INTO presentation_slide_imports VALUES(?,?)",
            params![slide.to_string(), reference.to_string()],
        )
        .map_err(failure)?;
    }
    for b in blocks {
        tx.execute(
            "INSERT INTO presentation_slide_evidence VALUES(?,?)",
            params![slide.to_string(), b.to_string()],
        )
        .map_err(failure)?;
    }
    tx.execute(
        "UPDATE presentation_runs SET version=version+1 WHERE id=?",
        [r.id.to_string()],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn render_source(
    db: &mut rusqlite::Connection,
    r: Run,
) -> Result<Option<String>, Error> {
    jobs::active(db, &r)?;
    let hash = canvas::source(db, &r.id.to_string())?;
    db.execute("UPDATE presentation_runs SET stage='rendering',version=version+1 WHERE id=? AND stage!='rendering'",[r.id.to_string()]).map_err(failure)?;
    Ok(hash)
}
