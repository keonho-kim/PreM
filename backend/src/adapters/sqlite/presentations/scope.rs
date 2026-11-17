// Purpose: Project canonical outline nodes for a project-owned immutable generation design.
// Pattern: Read-only joins; actual selected leaf identities persist in existing slide versions.
// Usage: Scope preview validates the current design; admission reuses the pinned projection.
// Related: preparation.rs, admission.rs, modules/presentations/selection.rs.
use super::*;
pub(super) fn pinned(
    db: &rusqlite::Connection,
    p: Uuid,
    design: Uuid,
) -> Result<GenerationScope, Error> {
    let revision: Option<String> = db.query_row("SELECT e.outline_revision_id FROM presentation_designs d JOIN presentation_evidence_reviews e ON e.id=d.evidence_review_id WHERE d.id=? AND e.project_id=?", params![design.to_string(),p.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    let revision = revision.ok_or(Error::NotFound)?;
    let sections = db.prepare("SELECT n.node_id,n.parent_node_id,v.title FROM outline_revision_nodes n JOIN outline_node_versions v ON v.id=n.node_version_id WHERE n.revision_id=? ORDER BY n.position").map_err(failure)?.query_map([&revision],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?))).map_err(failure)?.map(|r| {let(id,parent,title)=r.map_err(failure)?; Ok(GenerationSection{id:uuid(id)?,parent_id:parent.map(uuid).transpose()?,title})}).collect::<Result<Vec<_>,Error>>()?;
    Ok(GenerationScope {
        outline_revision_id: uuid(revision)?,
        sections,
    })
}
pub(super) fn current(
    db: &rusqlite::Connection,
    p: Uuid,
    design: Uuid,
) -> Result<GenerationScope, Error> {
    let current = preparation::current(db, p)?;
    if !current.ready || current.design_id != Some(design) {
        return Err(Error::Conflict);
    }
    pinned(db, p, design)
}
