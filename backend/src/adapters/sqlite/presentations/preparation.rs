// Purpose: Read and confirm the exact outline/evidence set and selected template version.
// Pattern: One fingerprint over canonical identities, immutable reviews and CAS design heads.
// Usage: Studio evidence/template commands; generation admission rechecks this same contract.
// Related: source_snapshot.rs, V19 migration, modules/presentations/.
use super::*;
use sha2::{Digest, Sha256};
pub(super) fn project(db: &rusqlite::Connection, p: Uuid, write: bool) -> Result<(), Error> {
    let status: Option<String> = db
        .query_row(
            "SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",
            [p.to_string()],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    match status.as_deref() {
        None => Err(Error::NotFound),
        Some("active") => Ok(()),
        Some(_) if !write => Ok(()),
        _ => Err(Error::Conflict),
    }
}
pub(super) fn current(db: &rusqlite::Connection, p: Uuid) -> Result<Preparation, Error> {
    project(db, p, false)?;
    let source = super::super::source_snapshot::read(db, &p.to_string()).map_err(failure)?;
    let guide:Option<String>=db.query_row("SELECT id FROM project_guide_revisions WHERE project_id=? ORDER BY version DESC LIMIT 1",[p.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    let outline:Option<(String,String,Option<String>,bool)>=db.query_row("SELECT r.id,r.source_review_id,r.guide_revision_id,EXISTS(SELECT 1 FROM outline_confirmations c WHERE c.revision_id=r.id) FROM outline_heads h JOIN outline_revisions r ON r.id=h.current_revision_id WHERE h.project_id=?",[p.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(failure)?;
    let links=db.prepare("SELECT l.id,l.version,l.candidate_id,l.source_version_id,i.deleted_at,p.deleted_at FROM relation_links l JOIN source_versions v ON v.id=l.source_version_id JOIN source_items i ON i.id=v.item_id JOIN projects p ON p.id=i.project_id WHERE l.project_id=? AND l.active=1 ORDER BY l.id").map_err(failure)?.query_map([p.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<i64>>(4)?,r.get::<_,Option<i64>>(5)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&(&source.hash, &guide, &outline, &links))
            .map_err(|_| Error::Storage)?,
    ));
    let ready = source.ready
        && outline
            .as_ref()
            .is_some_and(|o| source.review.as_ref() == Some(&o.1) && o.2 == guide && o.3)
        && links.iter().all(|l| l.4.is_none() && l.5.is_none())
        && links.len() <= 40;
    let review: Option<String> = db
        .query_row(
            "SELECT id FROM presentation_evidence_reviews WHERE project_id=? AND fingerprint=?",
            params![p.to_string(), fingerprint],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    let (version, design): (i64, Option<String>) = db
        .query_row(
            "SELECT version,design_id FROM presentation_preparations WHERE project_id=?",
            [p.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?
        .unwrap_or((0, None));
    let design = if ready { design } else { None };
    let selected: Option<(String, Option<String>)> = if let Some(d) = design {
        db.query_row("SELECT id,template_job_id FROM presentation_designs WHERE id=? AND evidence_review_id=?",params![d,review],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?
    } else {
        None
    };
    let selected = selected.filter(|s| s.1.as_ref().is_none_or(|j| template(db, j).is_ok()));
    let count: i64 = if let Some(o) = outline {
        db.query_row("SELECT count(*) FROM outline_revision_nodes n WHERE n.revision_id=? AND NOT EXISTS(SELECT 1 FROM outline_revision_nodes c WHERE c.revision_id=n.revision_id AND c.parent_node_id=n.node_id)",[o.0],|r|r.get(0)).map_err(failure)?
    } else {
        0
    };
    let generated = if let Some(d) = selected.as_ref() {
        db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE design_id=? AND status='succeeded')",[&d.0],|r|r.get(0)).map_err(failure)?
    } else {
        false
    };
    Ok(Preparation {
        generated,
        version,
        fingerprint,
        ready,
        evidence_review_id: if ready {
            review.map(uuid).transpose()?
        } else {
            None
        },
        selected_count: links.len() as i64,
        design_id: selected.as_ref().map(|s| uuid(s.0.clone())).transpose()?,
        template_job_id: selected.and_then(|s| s.1).map(uuid).transpose()?,
        slide_count: count,
    })
}
pub(super) fn confirm(
    db: &mut rusqlite::Connection,
    p: Uuid,
    fingerprint: String,
) -> Result<Preparation, Error> {
    let tx = db.transaction().map_err(failure)?;
    project(&tx, p, true)?;
    let c = current(&tx, p)?;
    if c.fingerprint != fingerprint {
        return Err(Error::Conflict);
    }
    if !c.ready {
        return Err(Error::NotReady);
    }
    if c.evidence_review_id.is_none() {
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO presentation_evidence_reviews SELECT ?,?,current_revision_id,?,? FROM outline_heads WHERE project_id=?",params![id,p.to_string(),fingerprint,now(),p.to_string()]).map_err(failure)?;
        tx.execute("INSERT INTO presentation_evidence_links SELECT ?,id,version FROM relation_links WHERE project_id=? AND active=1",params![id,p.to_string()]).map_err(failure)?;
    }
    let result = current(&tx, p)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn template(db: &rusqlite::Connection, id: &str) -> Result<String, Error> {
    db.query_row("SELECT f.blob_sha256 FROM document_jobs j JOIN template_versions v ON v.id=j.template_version_id JOIN template_items i ON i.id=v.item_id JOIN file_registrations f ON f.id=v.file_registration_id JOIN template_import_links t ON t.job_id=j.id WHERE j.id=? AND j.status='succeeded' AND i.status='active' AND i.deleted_at IS NULL",[id],|r|r.get(0)).optional().map_err(failure)?.ok_or(Error::NotReady)
}
pub(super) fn design(
    db: &mut rusqlite::Connection,
    p: Uuid,
    i: Design,
) -> Result<Preparation, Error> {
    let tx = db.transaction().map_err(failure)?;
    project(&tx, p, true)?;
    let c = current(&tx, p)?;
    if c.version != i.expected_version || c.evidence_review_id != Some(i.evidence_review_id) {
        return Err(Error::Conflict);
    }
    if !c.ready {
        return Err(Error::NotReady);
    }
    if let Some(j) = i.template_job_id {
        template(&tx, &j.to_string())?;
    }
    if c.design_id.is_some() && c.template_job_id == i.template_job_id {
        return Ok(c);
    }
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO presentation_designs VALUES(?,?,?,?,?)",
        params![
            id,
            p.to_string(),
            i.evidence_review_id.to_string(),
            i.template_job_id.map(|v| v.to_string()),
            now()
        ],
    )
    .map_err(failure)?;
    tx.execute("INSERT INTO presentation_preparations VALUES(?,1,?) ON CONFLICT(project_id) DO UPDATE SET version=version+1,design_id=excluded.design_id",params![p.to_string(),id]).map_err(failure)?;
    let result = current(&tx, p)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
