// Purpose: Advance a durable, bounded search workspace only after each comparison phase commits.
// Pattern: Atomic stage transitions, immutable read windows and explicit partial-result termination.
// Usage: Relations worker requests the next action; legacy runs finish after their original pass.
// Related: reads.rs, pull.rs, V18__relation_workspaces.sql.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn projection(
    db: &rusqlite::Connection,
    id: Uuid,
) -> Result<Option<Exploration>, Error> {
    db.query_row("SELECT phase,round,(SELECT count(DISTINCT rd.block_id) FROM relation_reads rd JOIN relation_candidates c ON c.id=rd.candidate_id WHERE c.run_id=w.run_id),(SELECT coalesce(sum(added),0) FROM relation_pulls WHERE run_id=w.run_id),(SELECT count(*) FROM relation_candidates c LEFT JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=w.run_id AND (c.assessment_key IS NULL OR a.relation IN(4,5))),stop_reason FROM relation_workspaces w WHERE run_id=?",[id.to_string()],|r|Ok(Exploration{phase:r.get(0)?,round:r.get(1)?,read_blocks:r.get(2)?,added_candidates:r.get(3)?,unresolved:r.get(4)?,stop_reason:r.get(5)?})).optional().map_err(failure)
}
pub(super) fn advance(db: &mut rusqlite::Connection, run: Run) -> Result<Next, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &run)?;
    let state:Option<(i64,String,Option<String>,Option<i64>)>=tx.query_row("SELECT round,phase,planner_config_id,deadline_at FROM relation_workspaces WHERE run_id=?",[run.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(failure)?;
    let Some((round, phase, planner, deadline)) = state else {
        return Ok(Next::Complete);
    };
    if deadline.is_some_and(|t| t <= now()) {
        end(&tx, &run, "budget")?;
        tx.commit().map_err(failure)?;
        return Ok(Next::Complete);
    }
    if phase == "complete" {
        return Ok(Next::Complete);
    }
    let (pending,unknown,conflicts,positive,total):(i64,i64,i64,i64,i64)=tx.query_row("SELECT coalesce(sum(c.assessment_key IS NULL),0),coalesce(sum(a.relation=5),0),coalesce(sum(a.relation=4),0),coalesce(sum(a.relation IN(1,2,3)),0),count(*) FROM relation_candidates c LEFT JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=?",[run.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(failure)?;
    if pending > 0 {
        return Ok(Next::Compare);
    }
    if round == 0 && unknown + conflicts > 0 {
        tx.execute("INSERT INTO relation_workspace_peers SELECT ?1,row_number() OVER(ORDER BY extraction_id),id,excerpt_block_id,relation FROM (SELECT c.id,c.extraction_id,c.excerpt_block_id,a.relation,row_number() OVER(PARTITION BY c.extraction_id ORDER BY c.ordinal) AS n FROM relation_candidates c JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=?1 AND a.relation IN(2,4)) WHERE n=1 ORDER BY extraction_id LIMIT 4",[run.id.to_string()]).map_err(failure)?;
        let added = reads::expand(&tx, &run)?;
        tx.execute(
            "UPDATE relation_workspaces SET round=1,phase='context' WHERE run_id=?",
            [run.id.to_string()],
        )
        .map_err(failure)?;
        if added > 0 {
            tx.execute(
                "UPDATE relation_runs SET version=version+1,updated_at=? WHERE id=?",
                params![now(), run.id.to_string()],
            )
            .map_err(failure)?;
            tx.commit().map_err(failure)?;
            return Ok(Next::Compare);
        }
    }
    if round >= 2 || (positive > 0 && unknown == 0 && conflicts == 0) {
        end(
            &tx,
            &run,
            if unknown + conflicts > 0 {
                "needs_review"
            } else if total == 0 {
                "no_new_results"
            } else {
                "reviewed"
            },
        )?;
        tx.commit().map_err(failure)?;
        return Ok(Next::Complete);
    }
    tx.execute(
        "UPDATE relation_workspaces SET phase='discover' WHERE run_id=?",
        [run.id.to_string()],
    )
    .map_err(failure)?;
    tx.execute(
        "UPDATE relation_runs SET version=version+1,updated_at=? WHERE id=?",
        params![now(), run.id.to_string()],
    )
    .map_err(failure)?;
    let mut context = context::plan(&tx, &run)?.context;
    let evidence=tx.prepare("SELECT c.id,c.extraction_id,c.excerpt_block_id,b.text,a.relation FROM relation_candidates c JOIN content_blocks b ON b.id=c.excerpt_block_id LEFT JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=? AND (a.relation IN(4,5) OR a.relation IS NULL) ORDER BY c.ordinal LIMIT 6").map_err(failure)?.query_map([run.id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<i64>>(4)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let mut queries = Vec::new();
    let mut excerpts = Vec::new();
    for (id, _, _, text, relation) in evidence {
        let (_, window) = reads::window(&tx, &id)?;
        let content = if window.is_empty() { text } else { window };
        let terms = retrieval::terms(&content);
        let query = terms.iter().take(5).cloned().collect::<Vec<_>>().join(" ");
        if !query.is_empty() && !queries.contains(&query) && queries.len() < 3 {
            queries.push(clip_text(&query, 120));
        }
        excerpts.push(serde_json::json!({"excerpt":clip_text(&content,1600),"relation":relation}));
    }
    context["unresolved"] = serde_json::json!(excerpts);
    if queries.is_empty() && !run.query.is_empty() {
        queries.push(run.query.clone());
    }
    let out = Discovery {
        context,
        queries,
        planner: planner.map(uuid).transpose()?,
    };
    tx.commit().map_err(failure)?;
    Ok(Next::Discover(out))
}
pub(super) fn end(db: &rusqlite::Connection, run: &Run, reason: &str) -> Result<(), Error> {
    db.execute(
        "UPDATE relation_workspaces SET phase='complete',stop_reason=? WHERE run_id=?",
        params![reason, run.id.to_string()],
    )
    .map_err(failure)?;
    db.execute(
        "UPDATE relation_runs SET version=version+1,updated_at=? WHERE id=?",
        params![now(), run.id.to_string()],
    )
    .map_err(failure)?;
    Ok(())
}
