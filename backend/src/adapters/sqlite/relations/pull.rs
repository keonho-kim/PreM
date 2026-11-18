// Purpose: Expand a search workspace through bounded indexed queries with canonical provenance.
// Pattern: One atomic pull checkpoint; deduplicate before ranking limits and keep requested scope.
// Usage: Exploration supplies validated queries; no document bytes or text are copied.
// Related: retrieval.rs, exploration.rs, V1__baseline.sql.
use super::*;
use rusqlite::params;
pub(super) fn apply(
    db: &mut rusqlite::Connection,
    run: Run,
    queries: Vec<String>,
    request: Option<Uuid>,
) -> Result<(), Error> {
    if queries.len() > 3
        || queries
            .iter()
            .any(|q| q.trim().is_empty() || q.chars().count() > 120)
    {
        return Err(Error::Invalid);
    }
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &run)?;
    let (phase, deadline, planner): (String, Option<i64>, Option<String>) = tx
        .query_row(
            "SELECT phase,deadline_at,planner_config_id FROM relation_workspaces WHERE run_id=?",
            [run.id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(failure)?;
    if phase != "discover" {
        return Err(Error::Conflict);
    }
    if deadline.is_some_and(|t| t <= now()) {
        exploration::end(&tx, &run, "budget")?;
        tx.commit().map_err(failure)?;
        return Ok(());
    }
    if let Some(request) = request {
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM llm_requests WHERE id=? AND provider_config_version_id=? AND status='succeeded')",params![request.to_string(),planner],|r|r.get(0)).map_err(failure)?;
        if !valid {
            return Err(Error::Conflict);
        }
    } else if planner.is_some() {
        return Err(Error::Conflict);
    }
    let o = &run.options;
    let mut total: i64 = tx
        .query_row(
            "SELECT count(*) FROM relation_candidates WHERE run_id=?",
            [run.id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let mut added = 0;
    let eligible = format!("{} AND v.created_at<=?8", retrieval::ELIGIBLE);
    for (ordinal, query) in queries.iter().enumerate() {
        let fts = retrieval::fts_query(query);
        if fts.is_empty() {
            continue;
        }
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM relation_pulls WHERE run_id=? AND query=?)",
                params![run.id.to_string(), query],
                |r| r.get(0),
            )
            .map_err(failure)?;
        if exists {
            continue;
        }
        let sql = format!(
            "WITH eligible AS MATERIALIZED ({eligible}) SELECT b.id,p.extraction_id FROM content_blocks_fts JOIN content_blocks b ON b.rowid=content_blocks_fts.rowid JOIN document_pages p ON p.id=b.page_id WHERE content_blocks_fts MATCH ?7 AND b.kind!='image' AND EXISTS(SELECT 1 FROM eligible e WHERE e.extraction_id=p.extraction_id) AND NOT EXISTS(SELECT 1 FROM relation_candidates c WHERE c.run_id=?9 AND c.block_id=b.id) ORDER BY content_blocks_fts.rank,b.id LIMIT 8"
        );
        let rows = tx
            .prepare(&sql)
            .map_err(failure)?
            .query_map(
                params![
                    run.project_id.to_string(),
                    o.include_archived,
                    o.previous_versions,
                    o.source_project.map(|p| p.to_string()),
                    o.format,
                    o.since,
                    fts,
                    run.created_at,
                    run.id.to_string()
                ],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(failure)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(failure)?;
        let mut query_added = 0;
        for (block, ext) in rows {
            for kind in ["file", "block"] {
                if total >= 96 {
                    break;
                }
                let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM relation_candidates WHERE run_id=? AND extraction_id=? AND kind=? AND (?='file' OR block_id=?))",params![run.id.to_string(),ext,kind,kind,block],|r|r.get(0)).map_err(failure)?;
                if exists {
                    continue;
                }
                let id = Uuid::new_v4().to_string();
                tx.execute("INSERT INTO relation_candidates(id,run_id,ordinal,kind,extraction_id,block_id,excerpt_block_id,workspace_round) VALUES(?,?,?,?,?,?,?,2)",params![id,run.id.to_string(),total,kind,ext,if kind=="block" {Some(&block)}else{None},block]).map_err(failure)?;
                let sql = format!(
                    "WITH eligible AS ({eligible}) INSERT INTO relation_origins SELECT ?7,version_id,job_id FROM eligible WHERE extraction_id=?9"
                );
                tx.execute(
                    &sql,
                    params![
                        run.project_id.to_string(),
                        o.include_archived,
                        o.previous_versions,
                        o.source_project.map(|p| p.to_string()),
                        o.format,
                        o.since,
                        id,
                        run.created_at,
                        ext
                    ],
                )
                .map_err(failure)?;
                total += 1;
                query_added += 1;
            }
        }
        tx.execute(
            "INSERT INTO relation_pulls VALUES(?,?,?,?,?)",
            params![
                run.id.to_string(),
                ordinal as i64,
                query,
                request.map(|id| id.to_string()),
                query_added
            ],
        )
        .map_err(failure)?;
        added += query_added;
    }
    reads::initialize(&tx, run.id)?;
    tx.execute(
        "UPDATE relation_workspaces SET round=2,phase='compare' WHERE run_id=?",
        [run.id.to_string()],
    )
    .map_err(failure)?;
    if added == 0 {
        exploration::end(&tx, &run, "no_new_results")?;
    }
    tx.execute(
        "UPDATE relation_runs SET version=version+1,updated_at=? WHERE id=?",
        params![now(), run.id.to_string()],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
