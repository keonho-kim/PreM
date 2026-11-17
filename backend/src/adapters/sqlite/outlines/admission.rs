// Purpose: Admit explicit outline/model work with immutable source, guide and model revisions.
// Pattern: One short transaction snapshots block identities and bounded checkpoint batches.
// Usage: Generate or scoped auto-map; no execution occurs on guide/source settings changes.
// Related: jobs.rs, plans.rs, context.rs.
use super::*;
pub(super) fn create(
    db: &mut rusqlite::Connection,
    p: Uuid,
    key: Uuid,
    input: Generate,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    context::current(&tx, p, true)?;
    let fingerprint = serde_json::to_string(&(p, &input)).map_err(|_| Error::Storage)?;
    if let Some((id, old)) = tx
        .query_row(
            "SELECT id,fingerprint FROM outline_runs WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(failure)?
    {
        if old != fingerprint {
            return Err(Error::Idempotency);
        }
        return queries::run(&tx, p, &id);
    }
    let c = context::expected(&tx, p, &input.source_snapshot, input.guide_version)?;
    let (version, revision) = context::head(&tx, p)?;
    if version != input.expected_version {
        return Err(Error::Conflict);
    }
    let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM outline_runs WHERE project_id=? AND status IN('queued','running')) OR (SELECT count(*) FROM outline_runs WHERE status IN('queued','running'))>=20",[p.to_string()],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    let config =
        super::super::writing_model::resolve(&tx, input.connection_id, input.model_version)
            .map_err(failure)?
            .ok_or(Error::Conflict)?;
    let mut scope = input.node_ids;
    if input.kind == "map" {
        let old = queries::draft(&tx, revision.as_deref().ok_or(Error::NotReady)?)?;
        let (review, guide): (String, Option<String>) = tx
            .query_row(
                "SELECT source_review_id,guide_revision_id FROM outline_revisions WHERE id=?",
                [revision.as_ref().ok_or(Error::NotReady)?],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(failure)?;
        context::pinned(&tx, p, &review, guide.as_deref())?;
        if scope.is_empty() {
            scope = old
                .nodes
                .iter()
                .filter(|n| !old.nodes.iter().any(|c| c.parent_id == Some(n.id)))
                .map(|n| n.id)
                .collect();
        }
        let unique: std::collections::HashSet<_> = scope.iter().collect();
        if unique.len() != scope.len()
            || scope
                .iter()
                .any(|id| !old.nodes.iter().any(|n| n.id == *id))
        {
            return Err(Error::Invalid);
        }
    } else if !scope.is_empty() {
        return Err(Error::Invalid);
    }
    let review = c.review.ok_or(Error::NotReady)?;
    let rows=tx.prepare("WITH candidates AS (SELECT b.id,min(r.source_version_id) AS source,b.kind,p.ordinal,b.position FROM project_source_review_files r JOIN document_pages p ON p.extraction_id=r.extraction_id JOIN content_blocks b ON b.page_id=p.id WHERE r.review_id=? GROUP BY b.id),ranked AS(SELECT *,row_number() OVER(PARTITION BY source ORDER BY CASE kind WHEN 'heading' THEN 0 ELSE 1 END,ordinal,position,id) AS n FROM candidates) SELECT id,source FROM ranked ORDER BY n,source LIMIT 2001").map_err(failure)?.query_map([&review],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    if rows.len() > 2000 {
        return Err(Error::Limit);
    }
    if rows.is_empty() {
        return Err(Error::NotReady);
    }
    let id = Uuid::new_v4();
    tx.execute("INSERT INTO outline_runs(id,project_id,request_key,fingerprint,kind,base_version,source_review_id,guide_revision_id,config_id,scope_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)",params![id.to_string(),p.to_string(),key.to_string(),fingerprint,input.kind,version,review,c.guide,config,serde_json::to_string(&scope).map_err(|_|Error::Storage)?,now()]).map_err(failure)?;
    for (i, (block, source)) in rows.iter().enumerate() {
        let batch = if input.kind == "generate" {
            if i < 48 { 0 } else { -1 }
        } else {
            (i / 8) as i64
        };
        tx.execute(
            "INSERT INTO outline_run_blocks VALUES(?,?,?,?,?)",
            params![id.to_string(), block, source, i as i64, batch],
        )
        .map_err(failure)?;
        if batch >= 0 {
            tx.execute(
                "INSERT OR IGNORE INTO outline_run_batches(run_id,batch) VALUES(?,?)",
                params![id.to_string(), batch],
            )
            .map_err(failure)?;
        }
    }
    let result = queries::run(&tx, p, &id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
