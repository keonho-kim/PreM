// Purpose: Read project-scoped generation history, checkpoints and authorized output files.
// Pattern: Canonical joins with no secret/config payloads in serialized projections.
// Usage: HTTP reads and the supervised generation worker.
// Related: preparation.rs, jobs.rs, V19 migration.
use super::*;
pub(super) fn run(db: &rusqlite::Connection, p: Uuid, id: &str) -> Result<Run, Error> {
    preparation::project(db, p, false)?;
    db.query_row("SELECT r.id,r.project_id,r.presentation_id,p.title,r.status,r.stage,r.version,(SELECT count(*) FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=r.id AND s.spec_sha256 IS NOT NULL),(SELECT count(*) FROM presentation_run_slides x WHERE x.run_id=r.id),r.error_code,r.created_at,r.config_id,r.lease,r.runtime_profile,p.version,p.current_revision_id=r.id FROM presentation_runs r JOIN presentations p ON p.id=r.presentation_id WHERE r.id=? AND r.project_id=?",params![id,p.to_string()],|r|Ok(Run{id:parse(r.get(0)?)?,project_id:parse(r.get(1)?)?,presentation_id:parse(r.get(2)?)?,title:r.get(3)?,status:r.get(4)?,stage:r.get(5)?,version:r.get(6)?,completed:r.get(7)?,total:r.get(8)?,error_code:r.get(9)?,created_at:r.get(10)?,config_id:parse(r.get(11)?)?,lease:r.get(12)?,runtime_profile:r.get(13)?,presentation_version:r.get(14)?,is_current:r.get::<_,Option<bool>>(15)?.unwrap_or(false)})).optional().map_err(failure)?.ok_or(Error::NotFound)
}
fn parse(s: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&s).map_err(|_| rusqlite::Error::InvalidQuery)
}
pub(super) fn runs(db: &rusqlite::Connection, p: Uuid) -> Result<Vec<Run>, Error> {
    preparation::project(db, p, false)?;
    let ids=db.prepare("SELECT id FROM presentation_runs WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 50").map_err(failure)?.query_map([p.to_string()],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    ids.iter().map(|id| run(db, p, id)).collect()
}
pub(super) fn slides(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
) -> Result<Vec<StoredSlide>, Error> {
    run(db, p, &id.to_string())?;
    db.prepare("SELECT s.id,x.position,s.spec_sha256,s.preview_sha256 IS NOT NULL FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? ORDER BY x.position").map_err(failure)?.query_map([id.to_string()],|r|Ok(StoredSlide{id:parse(r.get(0)?)?,position:r.get(1)?,spec:r.get(2)?,preview:r.get(3)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
}
pub(super) fn file(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    slide: Option<Uuid>,
) -> Result<File, Error> {
    let r = run(db, p, &id.to_string())?;
    if r.status != "succeeded" {
        return Err(Error::NotReady);
    }
    let (hash, size): (String, i64) = if let Some(slide) = slide {
        db.query_row("SELECT b.sha256,b.size_bytes FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id JOIN file_blobs b ON b.sha256=s.preview_sha256 WHERE x.run_id=? AND s.id=?",params![id.to_string(),slide.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?.ok_or(Error::NotFound)?
    } else {
        db.query_row("SELECT b.sha256,b.size_bytes FROM presentation_revisions r JOIN file_blobs b ON b.sha256=r.output_sha256 WHERE r.id=?",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?.ok_or(Error::NotFound)?
    };
    Ok(File {
        hash,
        size: size.try_into().map_err(|_| Error::Storage)?,
        mime: if slide.is_some() {
            "image/png"
        } else {
            crate::modules::assets::Format::Pptx.mime()
        },
    })
}
