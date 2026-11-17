// Purpose: Atomically publish a validated presentation and its slide preview lineage.
// Pattern: Check lease and current inputs before advancing the presentation head.
// Usage: Renderer publishes bytes first; interrupted commits leave collectible orphan blobs only.
// Related: plans.rs, jobs.rs, V19 migration.
use super::*;
pub(super) fn complete(
    db: &mut rusqlite::Connection,
    r: Run,
    rendered: Rendered,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    let (base, design, deck): (i64, Option<String>, String) = tx
        .query_row(
            "SELECT base_version,design_id,presentation_id FROM presentation_runs WHERE id=?",
            [r.id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(failure)?;
    if !canvas::authored(&tx, &r.id.to_string())?
        && !edits::is_edit(&tx, &r.id.to_string())?
        && preparation::current(&tx, r.project_id)?.design_id != design.map(uuid).transpose()?
    {
        return Err(Error::Conflict);
    }
    let slides = queries::slides(&tx, r.project_id, r.id)?;
    if slides.is_empty()
        || slides.len() != rendered.previews.len()
        || slides.iter().any(|s| s.spec.is_none())
    {
        return Err(Error::Storage);
    }
    plans::blob(
        &tx,
        &rendered.output,
        crate::modules::assets::Format::Pptx.mime(),
        "pptx",
    )?;
    tx.execute(
        "INSERT INTO presentation_revisions VALUES(?,?,?,?,?)",
        params![
            r.id.to_string(),
            deck,
            base + 1,
            rendered.output.sha256,
            now()
        ],
    )
    .map_err(failure)?;
    for (s, b) in slides.iter().zip(&rendered.previews) {
        let produced: bool = tx
            .query_row(
                "SELECT run_id=? FROM presentation_slide_versions WHERE id=?",
                params![r.id.to_string(), s.id.to_string()],
                |row| row.get(0),
            )
            .map_err(failure)?;
        if produced {
            plans::blob(&tx, b, "image/png", "png")?;
            tx.execute(
                "UPDATE presentation_slide_versions SET preview_sha256=? WHERE id=?",
                params![b.sha256, s.id.to_string()],
            )
            .map_err(failure)?;
        }
        tx.execute(
            "INSERT INTO presentation_revision_slides VALUES(?,?,?)",
            params![r.id.to_string(), s.id.to_string(), s.position],
        )
        .map_err(failure)?;
    }
    history::push(&tx, &r)?;
    if tx.execute("UPDATE presentations SET version=version+1,current_revision_id=? WHERE id=? AND version=?",params![r.id.to_string(),deck,base]).map_err(failure)?!=1{return Err(Error::Conflict)}
    tx.execute("UPDATE presentation_runs SET status='succeeded',stage='complete',version=version+1,lease=NULL,lease_until=NULL WHERE id=?",[r.id.to_string()]).map_err(failure)?;
    execution::publish(&tx, &r)?;
    edits::mark_applied(&tx, &r.id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(())
}
