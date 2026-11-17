// Purpose: Persist real before-commit deck previews and reuse validated bytes on acceptance.
// Pattern: Render outside transactions, then checkpoint under the original edit lease.
// Usage: Edit worker; source slide IDs stay stable for preview URLs and later run mapping.
// Related: targets.rs, apply.rs, modules/presentations/preview.rs.
use super::*;
use crate::modules::assets::DerivedFormat;
pub(in crate::adapters::sqlite::presentations) fn source(
    db: &rusqlite::Connection,
    e: Edit,
) -> Result<(Vec<StoredSlide>, Option<String>), Error> {
    active(db, &e)?;
    current(db, &e)?;
    let fresh = get(db, e.project_id, &e.id.to_string())?;
    if fresh.targets.iter().any(|t| !t.completed) {
        return Err(Error::NotReady);
    }
    let mut slides = super::super::queries::slides(db, e.project_id, e.base_revision_id)?;
    for s in &mut slides {
        if let Some(t) = fresh.targets.iter().find(|t| t.slide_id == s.id) {
            s.spec = t.proposed_spec.clone();
        }
    }
    let template = super::super::canvas::source(db, &e.base_revision_id.to_string())?;
    Ok((slides, template))
}
pub(in crate::adapters::sqlite::presentations) fn ready(
    db: &mut rusqlite::Connection,
    e: Edit,
    rendered: Rendered,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    let (slides, _) = source(&tx, e.clone())?;
    if slides.len() != rendered.previews.len() {
        return Err(Error::Storage);
    }
    super::super::plans::blob(
        &tx,
        &rendered.output,
        crate::modules::assets::Format::Pptx.mime(),
        "pptx",
    )?;
    tx.execute(
        "INSERT INTO presentation_edit_renders VALUES(?,?)",
        params![e.id.to_string(), rendered.output.sha256],
    )
    .map_err(failure)?;
    for (s, b) in slides.iter().zip(&rendered.previews) {
        super::super::plans::blob(&tx, b, "image/png", "png")?;
        tx.execute(
            "INSERT INTO presentation_edit_previews VALUES(?,?,?,?)",
            params![e.id.to_string(), s.id.to_string(), s.position, b.sha256],
        )
        .map_err(failure)?;
    }
    execution::rendered(&tx, &e)?;
    tx.execute("UPDATE presentation_edits SET status='ready',version=version+1,lease=NULL,lease_until=NULL WHERE id=?",[e.id.to_string()]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(in crate::adapters::sqlite::presentations) fn preview(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    slide: Uuid,
) -> Result<File, Error> {
    preparation::project(db, p, false)?;
    db.query_row("SELECT b.sha256,b.size_bytes FROM presentation_edits e JOIN presentation_edit_previews v ON v.edit_id=e.id JOIN file_blobs b ON b.sha256=v.preview_sha256 WHERE e.id=? AND e.project_id=? AND v.source_slide_id=?",params![id.to_string(),p.to_string(),slide.to_string()],|r|Ok(File{hash:r.get(0)?,size:r.get::<_,i64>(1)?.try_into().map_err(|_|rusqlite::Error::InvalidQuery)?,mime:"image/png"})).optional().map_err(failure)?.ok_or(Error::NotFound)
}
pub(in crate::adapters::sqlite::presentations) fn cached(
    db: &rusqlite::Connection,
    r: Run,
) -> Result<Option<Rendered>, Error> {
    super::super::jobs::active(db, &r)?;
    let row:Option<(String,String,i64)>=db.query_row("SELECT e.id,b.sha256,b.size_bytes FROM presentation_edits e JOIN presentation_edit_renders c ON c.edit_id=e.id JOIN file_blobs b ON b.sha256=c.output_sha256 WHERE e.applied_run_id=?",[r.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?;
    let Some((id, hash, size)) = row else {
        return Ok(None);
    };
    let previews=db.prepare("SELECT b.sha256,b.size_bytes FROM presentation_edit_previews p JOIN file_blobs b ON b.sha256=p.preview_sha256 WHERE p.edit_id=? ORDER BY p.position").map_err(failure)?.query_map([id],|r|Ok(DerivedBlob{sha256:r.get(0)?,size:r.get::<_,i64>(1)?.try_into().map_err(|_|rusqlite::Error::InvalidQuery)?,format:DerivedFormat::Png})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    Ok(Some(Rendered {
        output: DerivedBlob {
            sha256: hash,
            size: size.try_into().map_err(|_| Error::Storage)?,
            format: DerivedFormat::Binary,
        },
        previews,
    }))
}
