// Purpose: Reconstruct bounded model context from pinned canonical IDs and apply completed batches.
// Pattern: No original-text copies in checkpoints; output aliases are validated before revision commit.
// Usage: Outline worker reads one missing batch, persists it, then atomically publishes a new revision.
// Related: jobs.rs, revisions.rs, modules/outlines/model.rs.
use super::*;
use serde_json::{Value, json};
fn aliases(
    db: &rusqlite::Connection,
    run: &Run,
    batch: i64,
) -> Result<Vec<(String, Uuid, String)>, Error> {
    db.prepare("SELECT ordinal,block_id,b.text FROM outline_run_blocks r JOIN content_blocks b ON b.id=r.block_id WHERE run_id=? AND batch=? ORDER BY ordinal").map_err(failure)?.query_map(params![run.id.to_string(),batch],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(failure)?.map(|r|{let(i,id,text)=r.map_err(failure)?;let limit=if run.kind=="generate"{240}else{600};let end=text.floor_char_boundary(text.len().min(limit));Ok((format!("b{i}"),uuid(id)?,text[..end].to_owned()))}).collect()
}
fn targets(db: &rusqlite::Connection, run: &Run) -> Result<Vec<(String, Node)>, Error> {
    if run.kind == "generate" {
        return Ok(vec![]);
    }
    let (version, scope): (i64, String) = db
        .query_row(
            "SELECT base_version,scope_json FROM outline_runs WHERE id=?",
            [run.id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(failure)?;
    let revision: String = db
        .query_row(
            "SELECT id FROM outline_revisions WHERE project_id=? AND number=?",
            params![run.project_id.to_string(), version],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let scope: Vec<Uuid> = serde_json::from_str(&scope).map_err(|_| Error::Storage)?;
    Ok(queries::draft(db, &revision)?
        .nodes
        .into_iter()
        .filter(|n| scope.contains(&n.id))
        .enumerate()
        .map(|(i, n)| (format!("s{i}"), n))
        .collect())
}
pub(super) fn next(db: &mut rusqlite::Connection, run: Run) -> Result<Option<Plan>, Error> {
    jobs::active(db, &run)?;
    let batch:Option<i64>=db.query_row("SELECT batch FROM outline_run_batches WHERE run_id=? AND response_json IS NULL ORDER BY batch LIMIT 1",[run.id.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    let Some(batch) = batch else { return Ok(None) };
    let guide:Option<(String,String)>=db.query_row("SELECT g.do_text,g.dont_text FROM outline_runs r JOIN project_guide_revisions g ON g.id=r.guide_revision_id WHERE r.id=?",[run.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let blocks = aliases(db, &run, batch)?;
    let nodes = targets(db, &run)?;
    let context = json!({"task":run.kind,"direction":guide.map(|(a,b)|json!({"do":a,"dont":b})),"source_excerpts":blocks.iter().map(|(key,_,text)|json!({"key":key,"text":text})).collect::<Vec<_>>(),"sections":nodes.iter().map(|(key,n)|json!({"key":key,"title":n.title,"description":n.description.chars().take(40).collect::<String>()})).collect::<Vec<_>>()});
    Ok(Some(Plan {
        batch,
        context,
        blocks: blocks.into_iter().map(|(k, id, _)| (k, id)).collect(),
        nodes: nodes.into_iter().map(|(k, n)| (k, n.id)).collect(),
    }))
}
pub(super) fn checkpoint(
    db: &mut rusqlite::Connection,
    r: Run,
    batch: i64,
    value: Value,
    request: Uuid,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    if tx.execute("UPDATE outline_run_batches SET response_json=?,request_id=? WHERE run_id=? AND batch=? AND response_json IS NULL",params![value.to_string(),request.to_string(),r.id.to_string(),batch]).map_err(failure)?!=1{return Err(Error::Conflict)}
    tx.execute(
        "UPDATE outline_runs SET version=version+1 WHERE id=?",
        [r.id.to_string()],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn complete(db: &mut rusqlite::Connection, r: Run) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    let (base, review, guide): (i64, String, Option<String>) = tx
        .query_row(
            "SELECT base_version,source_review_id,guide_revision_id FROM outline_runs WHERE id=?",
            [r.id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(failure)?;
    let outputs = tx
        .prepare(
            "SELECT batch,response_json FROM outline_run_batches WHERE run_id=? ORDER BY batch",
        )
        .map_err(failure)?
        .query_map([r.id.to_string()], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(failure)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    if outputs.is_empty() || outputs.iter().any(|(_, v)| v.is_none()) {
        return Err(Error::Conflict);
    }
    let target_nodes = targets(&tx, &r)?;
    let target_ids: Vec<_> = target_nodes.iter().map(|(_, n)| n.id).collect();
    let mut draft = if r.kind == "map" {
        let id: String = tx
            .query_row(
                "SELECT id FROM outline_revisions WHERE project_id=? AND number=?",
                params![r.project_id.to_string(), base],
                |r| r.get(0),
            )
            .map_err(failure)?;
        let mut d = queries::draft(&tx, &id)?;
        d.assignments.retain(|a| !target_ids.contains(&a.node_id));
        d
    } else {
        Draft {
            nodes: vec![],
            assignments: vec![],
        }
    };
    for (batch, value) in outputs {
        let value: Value = serde_json::from_str(value.as_deref().ok_or(Error::Conflict)?)
            .map_err(|_| Error::Storage)?;
        let blocks: Vec<_> = aliases(&tx, &r, batch)?
            .into_iter()
            .map(|(k, id, _)| (k, id))
            .collect();
        if r.kind == "generate" {
            draft = crate::modules::outlines::generated_draft(&value, &blocks)?;
        } else {
            let nodes = target_nodes
                .iter()
                .map(|(k, n)| (k.clone(), n.id))
                .collect::<Vec<_>>();
            draft
                .assignments
                .extend(crate::modules::outlines::mapped_assignments(
                    &value, &blocks, &nodes,
                )?);
        }
    }
    let revision = revisions::commit(
        &tx,
        r.project_id,
        base,
        &review,
        guide.as_deref(),
        draft,
        &r.kind,
    )?;
    tx.execute("UPDATE outline_runs SET status='succeeded',result_revision_id=?,lease=NULL,lease_until=NULL,version=version+1 WHERE id=?",params![revision,r.id.to_string()]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
