// Purpose: Validate project authoring scope and resolve reviewed source/guide versions.
// Pattern: Canonical read-only joins; accepted inputs are pinned by immutable IDs.
// Usage: Revision and workflow commands share this boundary.
// Related: source_snapshot.rs, queries.rs, revisions.rs.
use super::*;
pub(super) struct Inputs {
    pub snapshot: String,
    pub review: Option<String>,
    pub guide: Option<String>,
    pub guide_version: i64,
    pub ready: bool,
}
pub(super) fn current(db: &rusqlite::Connection, p: Uuid, write: bool) -> Result<Inputs, Error> {
    let status: Option<String> = db
        .query_row(
            "SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",
            [p.to_string()],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    let status = status.ok_or(Error::NotFound)?;
    if write && status != "active" {
        return Err(Error::Conflict);
    }
    let source = super::super::source_snapshot::read(db, &p.to_string()).map_err(failure)?;
    let guide:Option<(String,i64)>=db.query_row("SELECT id,version FROM project_guide_revisions WHERE project_id=? ORDER BY version DESC LIMIT 1",[p.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    Ok(Inputs {
        snapshot: source.hash,
        ready: source.ready && source.review.is_some(),
        review: source.review,
        guide: guide.as_ref().map(|v| v.0.clone()),
        guide_version: guide.map_or(0, |v| v.1),
    })
}
pub(super) fn expected(
    db: &rusqlite::Connection,
    p: Uuid,
    snapshot: &str,
    guide: i64,
) -> Result<Inputs, Error> {
    let c = current(db, p, true)?;
    if c.snapshot != snapshot || c.guide_version != guide {
        return Err(Error::Conflict);
    }
    if !c.ready {
        return Err(Error::NotReady);
    }
    Ok(c)
}
pub(super) fn head(db: &rusqlite::Connection, p: Uuid) -> Result<(i64, Option<String>), Error> {
    Ok(db
        .query_row(
            "SELECT version,current_revision_id FROM outline_heads WHERE project_id=?",
            [p.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?
        .unwrap_or((0, None)))
}
pub(super) fn origin(
    db: &rusqlite::Connection,
    review: &str,
    block: Uuid,
) -> Result<String, Error> {
    db.query_row("SELECT min(r.source_version_id) FROM project_source_review_files r JOIN document_pages p ON p.extraction_id=r.extraction_id JOIN content_blocks b ON b.page_id=p.id WHERE r.review_id=? AND b.id=? HAVING count(*)>0",params![review,block.to_string()],|r|r.get(0)).optional().map_err(failure)?.ok_or(Error::Invalid)
}
pub(super) fn pinned(
    db: &rusqlite::Connection,
    p: Uuid,
    review: &str,
    guide: Option<&str>,
) -> Result<(), Error> {
    let c = current(db, p, true)?;
    if !c.ready || c.review.as_deref() != Some(review) || c.guide.as_deref() != guide {
        return Err(Error::Conflict);
    }
    Ok(())
}
