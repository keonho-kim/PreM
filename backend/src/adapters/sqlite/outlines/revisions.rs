// Purpose: Commit immutable outline revisions and source assignments with optimistic concurrency.
// Pattern: Reuse unchanged node versions; one transaction changes the head and preserves history.
// Usage: Manual save and validated AI completion call the same commit boundary.
// Related: context.rs, queries.rs, V17 migration.
use super::*;
pub(super) fn commit(
    tx: &rusqlite::Transaction<'_>,
    p: Uuid,
    expected: i64,
    review: &str,
    guide: Option<&str>,
    draft: Draft,
    origin: &str,
) -> Result<String, Error> {
    crate::modules::outlines::validate_draft(&draft)?;
    let (version, parent) = context::head(tx, p)?;
    if version != expected {
        return Err(Error::Conflict);
    }
    context::pinned(tx, p, review, guide)?;
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO outline_revisions VALUES(?,?,?,?,?,?,?,?)",
        params![
            id,
            p.to_string(),
            version + 1,
            parent,
            review,
            guide,
            origin,
            now()
        ],
    )
    .map_err(failure)?;
    for (position, n) in draft.nodes.iter().enumerate() {
        let owner: Option<String> = tx
            .query_row(
                "SELECT project_id FROM outline_nodes WHERE id=?",
                [n.id.to_string()],
                |r| r.get(0),
            )
            .optional()
            .map_err(failure)?;
        if owner.is_some_and(|owner| owner != p.to_string()) {
            return Err(Error::Invalid);
        }
        tx.execute(
            "INSERT OR IGNORE INTO outline_nodes VALUES(?,?)",
            params![n.id.to_string(), p.to_string()],
        )
        .map_err(failure)?;
        let title = n.title.trim();
        let description = n.description.trim();
        tx.execute(
            "INSERT OR IGNORE INTO outline_node_versions VALUES(?,?,?,?)",
            params![
                Uuid::new_v4().to_string(),
                n.id.to_string(),
                title,
                description
            ],
        )
        .map_err(failure)?;
        let node_version:String=tx.query_row("SELECT id FROM outline_node_versions WHERE node_id=? AND title=? AND description=?",params![n.id.to_string(),title,description],|r|r.get(0)).map_err(failure)?;
        tx.execute(
            "INSERT INTO outline_revision_nodes VALUES(?,?,?,?,?)",
            params![
                id,
                n.id.to_string(),
                node_version,
                n.parent_id.map(|id| id.to_string()),
                position as i64
            ],
        )
        .map_err(failure)?;
    }
    for link in draft.assignments {
        let source = context::origin(tx, review, link.block_id)?;
        tx.execute(
            "INSERT INTO outline_assignments VALUES(?,?,?,?)",
            params![
                id,
                link.node_id.to_string(),
                link.block_id.to_string(),
                source
            ],
        )
        .map_err(failure)?;
    }
    tx.execute("INSERT INTO outline_heads VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,current_revision_id=excluded.current_revision_id",params![p.to_string(),version+1,id]).map_err(failure)?;
    Ok(id)
}
pub(super) fn save(db: &mut rusqlite::Connection, p: Uuid, e: Edit) -> Result<State, Error> {
    let tx = db.transaction().map_err(failure)?;
    let c = context::expected(&tx, p, &e.source_snapshot, e.guide_version)?;
    commit(
        &tx,
        p,
        e.expected_version,
        c.review.as_deref().ok_or(Error::NotReady)?,
        c.guide.as_deref(),
        e.draft,
        "manual",
    )?;
    tx.commit().map_err(failure)?;
    queries::state(db, p, None)
}
pub(super) fn confirm(db: &mut rusqlite::Connection, p: Uuid, v: i64) -> Result<State, Error> {
    let tx = db.transaction().map_err(failure)?;
    let c = context::current(&tx, p, true)?;
    let (version, revision) = context::head(&tx, p)?;
    if v != version {
        return Err(Error::Conflict);
    }
    let revision = revision.ok_or(Error::NotReady)?;
    let (review, guide): (String, Option<String>) = tx
        .query_row(
            "SELECT source_review_id,guide_revision_id FROM outline_revisions WHERE id=?",
            [&revision],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(failure)?;
    if !c.ready || c.review.as_deref() != Some(&review) || c.guide != guide {
        return Err(Error::Conflict);
    }
    let draft = queries::draft(&tx, &revision)?;
    if draft
        .nodes
        .iter()
        .filter(|n| {
            !draft
                .nodes
                .iter()
                .any(|child| child.parent_id == Some(n.id))
        })
        .any(|n| !draft.assignments.iter().any(|a| a.node_id == n.id))
    {
        return Err(Error::Unmapped);
    }
    tx.execute(
        "INSERT OR IGNORE INTO outline_confirmations VALUES(?,?)",
        params![revision, now()],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    queries::state(db, p, None)
}
