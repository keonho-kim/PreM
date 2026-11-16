// Purpose: Resolve generated slide citations to their pinned source version and actual page.
// Pattern: Read canonical blocks through the generation input's immutable relation/outline links.
// Usage: The slide reader opens exact-version document previews without exposing internal IDs.
// Related: queries.rs, presentation_slide_evidence, presentation_evidence_links.
use super::*;
pub(super) fn read(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    slide: Uuid,
) -> Result<Vec<Citation>, Error> {
    queries::run(db, p, &id.to_string())?;
    let valid: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM presentation_run_slides WHERE slide_version_id=? AND run_id=?)",
            params![slide.to_string(), id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if !valid {
        return Err(Error::NotFound);
    }
    let sql = "WITH inputs AS(SELECT e.id AS review,e.outline_revision_id AS outline FROM presentation_runs r JOIN presentation_designs d ON d.id=r.design_id JOIN presentation_evidence_reviews e ON e.id=d.evidence_review_id WHERE r.id=?1),pins AS(SELECT a.block_id,a.source_version_id FROM inputs i JOIN outline_assignments a ON a.revision_id=i.outline WHERE a.node_id=(SELECT node_id FROM presentation_slide_versions WHERE id=?2) UNION SELECT c.excerpt_block_id,l.source_version_id FROM inputs i JOIN presentation_evidence_links e ON e.review_id=i.review JOIN relation_link_changes h ON h.selection_id=e.selection_id AND h.version=e.selection_version JOIN relation_links l ON l.id=e.selection_id JOIN relation_candidates c ON c.id=h.candidate_id) SELECT b.id,substr(b.text,1,600),f.original_filename,pg.id,pg.label,s.project_id,s.id,s.version,v.number,(SELECT j.id FROM document_jobs j WHERE j.source_version_id=v.id AND j.extraction_id=pg.extraction_id ORDER BY j.generation DESC LIMIT 1),s.deleted_at IS NULL AND project.deleted_at IS NULL FROM presentation_slide_evidence e JOIN content_blocks b ON b.id=e.block_id JOIN document_pages pg ON pg.id=b.page_id JOIN pins ON pins.block_id=b.id JOIN source_versions v ON v.id=pins.source_version_id JOIN source_items s ON s.id=v.item_id JOIN projects project ON project.id=s.project_id JOIN file_registrations f ON f.id=v.file_registration_id WHERE e.slide_version_id=?2 ORDER BY b.id,v.id";
    let rows = db
        .prepare(sql)
        .map_err(failure)?
        .query_map(params![id.to_string(), slide.to_string()], |r| {
            fn id(r: &rusqlite::Row<'_>, n: usize) -> rusqlite::Result<Uuid> {
                Uuid::parse_str(&r.get::<_, String>(n)?).map_err(|_| rusqlite::Error::InvalidQuery)
            }
            Ok(Citation {
                block_id: id(r, 0)?,
                text: r.get(1)?,
                filename: r.get(2)?,
                page_id: id(r, 3)?,
                page_label: r.get(4)?,
                project_id: id(r, 5)?,
                item_id: id(r, 6)?,
                item_version: r.get(7)?,
                file_version: r.get(8)?,
                job_id: id(r, 9)?,
                available: r.get(10)?,
            })
        })
        .map_err(failure)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    let mut seen = std::collections::HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|r| seen.insert(r.block_id))
        .collect())
}
