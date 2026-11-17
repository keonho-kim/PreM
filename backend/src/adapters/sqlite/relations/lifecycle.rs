// Purpose: Own search admission, durable leases, commands and checkpoint completion.
// Pattern: Short SQLite transactions; candidates and model configuration are fixed before evaluation.
// Usage: HTTP starts runs; one supervised worker executes four batches at a time.
// Related: retrieval.rs, context.rs, settings.rs, queries.rs.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn create(
    db: &mut rusqlite::Connection,
    p: Uuid,
    key: Uuid,
    input: Search,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    context::project(&tx, p, true)?;
    let fingerprint = input_hash(&(p, &input));
    let old: Option<(String, String)> = tx
        .query_row(
            "SELECT id,fingerprint FROM relation_runs WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some((id, prior)) = old {
        if prior != fingerprint {
            return Err(Error::Idempotency);
        }
        return queries::get(&tx, p, Some(uuid(id)?))?.ok_or(Error::NotFound);
    }
    let busy:i64=tx.query_row("SELECT count(*) FROM relation_runs WHERE status IN('queued','running','waiting_configuration')",[],|r|r.get(0)).map_err(failure)?;
    if busy >= 20 {
        return Err(Error::Busy);
    }
    let snapshot = context::snapshot(&tx, p, true)?;
    let config = settings::config(&tx, settings::read(&tx)?.connection_id)?;
    if config.is_none() {
        return Err(Error::MissingModel);
    }
    let id = Uuid::new_v4();
    tx.execute("INSERT INTO relation_runs(id,project_id,request_key,fingerprint,query,options_json,snapshot_hash,guide_revision_id,config_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",params![id.to_string(),p.to_string(),key.to_string(),fingerprint,input.query,serde_json::to_string(&input.options).map_err(|_|Error::Storage)?,snapshot.hash,snapshot.guide,config,if config.is_some(){"queued"}else{"waiting_configuration"},now(),now()]).map_err(failure)?;
    for (v, e) in &snapshot.sources {
        tx.execute(
            "INSERT INTO relation_sources VALUES(?,?,?)",
            params![id.to_string(), v, e],
        )
        .map_err(failure)?;
    }
    retrieval::seed(&tx, id, p, &input, &snapshot)?;
    reads::initialize(&tx, id)?;
    let planner = settings::planner_config(&tx, settings::read(&tx)?.planner_connection_id)?;
    tx.execute(
        "INSERT INTO relation_workspaces(run_id,planner_config_id,created_at) VALUES(?,?,?)",
        params![id.to_string(), planner, now()],
    )
    .map_err(failure)?;

    let empty: bool = tx
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM relation_candidates WHERE run_id=?)",
            [id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if empty {
        let o = &input.options;
        let eligible: bool = tx
            .query_row(
                &format!("SELECT EXISTS({})", retrieval::ELIGIBLE),
                params![
                    p.to_string(),
                    o.include_archived,
                    o.previous_versions,
                    o.source_project.map(|v| v.to_string()),
                    o.format,
                    o.since
                ],
                |r| r.get(0),
            )
            .map_err(failure)?;
        if planner.is_none() || !eligible {
            tx.execute(
                "UPDATE relation_runs SET status='succeeded' WHERE id=?",
                [id.to_string()],
            )
            .map_err(failure)?;
            tx.execute("UPDATE relation_workspaces SET phase='complete',stop_reason='no_new_results' WHERE run_id=?",[id.to_string()]).map_err(failure)?;
            execution::empty(&tx, id)?;
        }
    }
    let result = queries::get(&tx, p, Some(id))?.ok_or(Error::Storage)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn claim(db: &mut rusqlite::Connection) -> Result<Option<Run>, Error> {
    let tx = db.transaction().map_err(failure)?;
    tx.execute("UPDATE relation_runs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='lease_expired',lease=NULL,lease_until=NULL,version=version+1 WHERE status='running' AND lease_until<?",[now()]).map_err(failure)?;
    if let Some(config) = settings::config(&tx, settings::read(&tx)?.connection_id)? {
        tx.execute("UPDATE relation_runs SET status='queued',config_id=?,version=version+1,updated_at=? WHERE status='waiting_configuration' AND config_id IS NULL",params![config,now()]).map_err(failure)?;
    }
    let id:Option<(String,String)>=tx.query_row("SELECT r.id,r.project_id FROM relation_runs r JOIN projects p ON p.id=r.project_id WHERE r.status='queued' AND p.deleted_at IS NULL ORDER BY r.created_at,r.id LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let Some((id, p)) = id else {
        tx.commit().map_err(failure)?;
        return Ok(None);
    };
    tx.execute("UPDATE relation_runs SET status='running',lease=?,lease_until=?,attempt=attempt+1,version=version+1,error_code=NULL,updated_at=? WHERE id=?",params![Uuid::new_v4().to_string(),now()+30000,now(),id]).map_err(failure)?;
    tx.execute(
        "UPDATE relation_workspaces SET deadline_at=coalesce(deadline_at,?) WHERE run_id=?",
        params![now() + 300000, id],
    )
    .map_err(failure)?;
    let run = queries::get(&tx, uuid(p)?, Some(uuid(id)?))?;
    tx.commit().map_err(failure)?;
    Ok(run)
}
pub(super) fn heartbeat(db: &rusqlite::Connection, run: &Run) -> Result<bool, Error> {
    if queries::active(db, run).is_err() {
        return Ok(false);
    }
    Ok(db
        .execute(
            "UPDATE relation_runs SET lease_until=? WHERE id=? AND lease=? AND status='running'",
            params![now() + 30000, run.id.to_string(), run.lease],
        )
        .map_err(failure)?
        == 1)
}
pub(super) fn cached(
    db: &mut rusqlite::Connection,
    run: Run,
    keys: Vec<(Uuid, String)>,
) -> Result<Vec<Uuid>, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &run)?;
    let mut missing = Vec::new();
    for (id, key) in keys {
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM relation_assessments WHERE cache_key=? AND config_id=?)",params![key,run.config.map(|v|v.to_string())],|r|r.get(0)).map_err(failure)?;
        if exists {
            tx.execute("UPDATE relation_candidates SET assessment_key=?,cache_hit=1 WHERE id=? AND run_id=? AND assessment_key IS NULL",params![key,id.to_string(),run.id.to_string()]).map_err(failure)?;
        } else {
            missing.push(id)
        }
    }
    tx.commit().map_err(failure)?;
    Ok(missing)
}
pub(super) fn commit(
    db: &mut rusqlite::Connection,
    run: Run,
    values: Vec<Assessment>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &run)?;
    for value in values {
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM llm_requests WHERE id=? AND provider_config_version_id=? AND status='succeeded')",params![value.request_id.to_string(),run.config.map(|v|v.to_string())],|r|r.get(0)).map_err(failure)?;
        if !valid || !(0..=5).contains(&value.relation) {
            return Err(Error::Conflict);
        }
        let (ext, block): (String, Option<String>) = tx
            .query_row(
                "SELECT extraction_id,block_id FROM relation_candidates WHERE id=? AND run_id=?",
                params![value.candidate.to_string(), run.id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(failure)?;
        tx.execute(
            "INSERT OR IGNORE INTO relation_assessments(cache_key,context_hash,extraction_id,block_id,config_id,definition_version,relation,statistics_json,request_id,created_at,context_version) VALUES(?,?,?,?,?,1,?,?,?,?,?)",
            params![
                value.key,
                value.context_hash,
                ext,
                block,
                run.config.map(|v| v.to_string()),
                value.relation,
                value.statistics.to_string(),
                value.request_id.to_string(),
                now(),
                if run.exploration.is_some() {2} else {1}
            ],
        )
        .map_err(failure)?;
        tx.execute("UPDATE relation_candidates SET assessment_key=? WHERE id=? AND run_id=? AND assessment_key IS NULL",params![value.key,value.candidate.to_string(),run.id.to_string()]).map_err(failure)?;
    }
    tx.execute(
        "UPDATE relation_runs SET version=version+1,updated_at=? WHERE id=?",
        params![now(), run.id.to_string()],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn finish(
    db: &mut rusqlite::Connection,
    run: Run,
    status: String,
    error: Option<String>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &run)?;
    if error.as_deref() == Some("search_budget_exhausted") {
        exploration::end(&tx, &run, "budget")?;
    }
    let error = if status == "succeeded" {
        execution::publish(&tx, &run)?;
        let budget:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM relation_workspaces WHERE run_id=? AND stop_reason='budget')",[run.id.to_string()],|r|r.get(0)).map_err(failure)?;
        if budget {
            Some("search_budget_exhausted".into())
        } else {
            error
        }
    } else {
        error
    };
    tx.execute("UPDATE relation_runs SET status=CASE WHEN ?1='queued' AND attempt>=3 THEN 'failed' ELSE ?1 END,error_code=?2,lease=NULL,lease_until=NULL,version=version+1,updated_at=?3 WHERE id=?4",params![status,error,now(),run.id.to_string()]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn command(
    db: &mut rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    expected: i64,
    key: Uuid,
    action: String,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    context::project(&tx, p, true)?;
    let run = queries::get(&tx, p, Some(id))?.ok_or(Error::NotFound)?;
    let old: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT run_id,expected_version,action FROM relation_commands WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some(old) = old {
        if old != (id.to_string(), expected, action) {
            return Err(Error::Idempotency);
        }
        return Ok(run);
    }
    if run.version != expected {
        return Err(Error::Conflict);
    }
    let status = match action.as_str() {
        "cancel"
            if ["queued", "running", "waiting_configuration"].contains(&run.status.as_str()) =>
        {
            "cancelled"
        }
        "retry" if ["failed", "cancelled"].contains(&run.status.as_str()) => {
            if run.config.is_some() {
                "queued"
            } else {
                "waiting_configuration"
            }
        }
        _ => return Err(Error::Conflict),
    };
    tx.execute("UPDATE relation_runs SET status=?,attempt=0,lease=NULL,lease_until=NULL,error_code=NULL,version=version+1,updated_at=? WHERE id=?",params![status,now(),id.to_string()]).map_err(failure)?;
    tx.execute(
        "INSERT INTO relation_commands VALUES(?,?,?,?)",
        params![key.to_string(), id.to_string(), expected, action],
    )
    .map_err(failure)?;
    let out = queries::get(&tx, p, Some(id))?.ok_or(Error::Storage)?;
    tx.commit().map_err(failure)?;
    Ok(out)
}
