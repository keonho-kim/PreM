// Purpose: Own durable job admission, leases, retry/cancel receipts and model pinning.
// Pattern: Short conditional transactions reject stale writes and retain checkpoints.
// Usage: Common engine driver claims from this store; HTTP commands use version and request keys.
// Related: queries.rs, results.rs, V1__baseline.sql.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn enqueue(
    db: &mut rusqlite::Connection,
    kind: String,
    item: Uuid,
    expected: i64,
    key: Uuid,
    profile: ExtractionProfiles,
) -> Result<Job, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::visible(&tx, &kind, item)?;
    let fingerprint =
        serde_json::to_string(&(&kind, item, expected)).map_err(|_| Error::Storage)?;
    let old: Option<(String, String)> = tx
        .query_row(
            "SELECT id,request_fingerprint FROM document_jobs WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some((id, old)) = old {
        if old != fingerprint {
            return Err(Error::Idempotency);
        }
        return queries::get(&tx, Uuid::parse_str(&id).map_err(|_| Error::Storage)?);
    }
    let p = queries::prefix(&kind)?;
    let (version, file): (i64, String) = tx
        .query_row(
            &format!(
                "SELECT version,current_version_id FROM {p}_items WHERE id=? AND deleted_at IS NULL"
            ),
            [item.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(failure)?;
    if version != expected {
        return Err(Error::Conflict);
    }
    let busy:bool=tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM document_jobs WHERE {p}_version_id=? AND status IN('queued','extracting','classifying','waiting_configuration'))"),[&file],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Conflict);
    }
    let generation: i64 = tx
        .query_row(
            &format!(
                "SELECT coalesce(max(generation),0)+1 FROM document_jobs WHERE {p}_version_id=?"
            ),
            [&file],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let id = Uuid::new_v4();
    let format: String = tx.query_row(&format!("SELECT b.format FROM {p}_versions v JOIN registered_file_facts b ON b.registration_id=v.file_registration_id WHERE v.id=?"), [&file], |r|r.get(0)).map_err(failure)?;
    let profile = profile.for_format(&format);
    tx.execute(&format!("INSERT INTO document_jobs(id,{p}_version_id,request_key,request_fingerprint,profile,status,created_at,updated_at,generation) VALUES(?,?,?,?,?,'queued',?,?,?)"),params![id.to_string(),file,key.to_string(),fingerprint,profile,now(),now(),generation]).map_err(failure)?;
    queries::event(&tx, id, "queued")?;
    let j = queries::get(&tx, id)?;
    tx.commit().map_err(failure)?;
    Ok(j)
}
pub(super) fn scan(
    db: &mut rusqlite::Connection,
    profile: ExtractionProfiles,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    tx.execute(
        "UPDATE document_jobs AS j SET profile=CASE WHEN (SELECT b.format FROM registered_file_facts b WHERE b.registration_id=coalesce((SELECT file_registration_id FROM reference_versions WHERE id=j.reference_version_id),(SELECT file_registration_id FROM template_versions WHERE id=j.template_version_id),(SELECT file_registration_id FROM source_versions WHERE id=j.source_version_id)))='md' THEN ?2 ELSE ?1 END WHERE profile='pending' AND status='queued'",
        [profile.document,profile.markdown],
    )
    .map_err(failure)?;
    let expired=tx.prepare("SELECT id FROM document_jobs WHERE status IN('extracting','classifying') AND lease_until<?").map_err(failure)?.query_map([now()],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for id in expired {
        execution::reset_running(&tx, Uuid::parse_str(&id).map_err(|_| Error::Storage)?)?;
    }
    tx.execute("UPDATE document_jobs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='lease_expired',lease=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE status IN('extracting','classifying') AND lease_until<?",params![now(),now()]).map_err(failure)?;
    if decision_config(&tx, queries::settings(&tx)?.connection_id)?.is_some() {
        tx.execute("UPDATE document_jobs SET status='queued',version=version+1,updated_at=? WHERE status='waiting_configuration'",[now()]).map_err(failure)?;
    }
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn claim(db: &mut rusqlite::Connection) -> Result<Option<Job>, Error> {
    let tx = db.transaction().map_err(failure)?;
    let id:Option<String>=tx.query_row("SELECT j.id FROM document_jobs j LEFT JOIN reference_versions rv ON rv.id=j.reference_version_id LEFT JOIN reference_items ri ON ri.id=rv.item_id LEFT JOIN template_versions tv ON tv.id=j.template_version_id LEFT JOIN template_items ti ON ti.id=tv.item_id LEFT JOIN source_versions sv ON sv.id=j.source_version_id LEFT JOIN source_items si ON si.id=sv.item_id WHERE j.status='queued' AND j.profile!='pending' AND j.retry_at<=? AND coalesce(ri.deleted_at,ti.deleted_at,si.deleted_at) IS NULL ORDER BY j.created_at,j.id LIMIT 1",[now()],|r|r.get(0)).optional().map_err(failure)?;
    let Some(id) = id else { return Ok(None) };
    let id = Uuid::parse_str(&id).map_err(|_| Error::Storage)?;
    execution::reset_running(&tx, id)?;
    let config = decision_config(&tx, queries::settings(&tx)?.connection_id)?;
    let current = queries::get(&tx, id)?;
    if current.kind != "templates" && current.config_id.is_none() && config.is_none() {
        tx.execute("UPDATE document_jobs SET status='waiting_configuration',version=version+1,updated_at=? WHERE id=?", params![now(),id.to_string()]).map_err(failure)?;
        queries::event(&tx, id, "waiting_configuration")?;
        tx.commit().map_err(failure)?;
        return Ok(None);
    }
    tx.execute("UPDATE document_jobs SET status=CASE WHEN extraction_id IS NULL THEN 'extracting' ELSE 'classifying' END,lease=?,lease_until=?,attempt=attempt+1,version=version+1,config_id=CASE WHEN template_version_id IS NULL THEN coalesce(config_id,?) ELSE NULL END,error_code=NULL,updated_at=? WHERE id=?",params![Uuid::new_v4().to_string(),now()+60_000,config,now(),id.to_string()]).map_err(failure)?;
    let job = queries::get(&tx, id)?;
    queries::event(&tx, id, &job.status)?;
    tx.commit().map_err(failure)?;
    Ok(Some(job))
}
pub(super) fn pin(db: &mut rusqlite::Connection, job: Job) -> Result<Job, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    let status = if job.config_id.is_some() {
        "classifying"
    } else {
        "waiting_configuration"
    };
    tx.execute("UPDATE document_jobs SET status=?,version=version+1,updated_at=?,lease=CASE WHEN ?='waiting_configuration' THEN NULL ELSE lease END,lease_until=CASE WHEN ?='waiting_configuration' THEN NULL ELSE lease_until END WHERE id=?",params![status,now(),status,status,job.id.to_string()]).map_err(failure)?;
    queries::event(&tx, job.id, status)?;
    let result = queries::get(&tx, job.id)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn finish(
    db: &mut rusqlite::Connection,
    job: Job,
    status: String,
    error: Option<String>,
    retry: bool,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    let status = if retry && job.attempt < 3 {
        "queued"
    } else {
        &status
    };
    if status == "queued" {
        execution::reset_running(&tx, job.id)?;
    }
    if status == "succeeded" {
        execution::publish(&tx, &job)?;
    }
    tx.execute("UPDATE document_jobs SET status=?,error_code=?,retry_at=?,lease=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?",params![status,error,now()+job.attempt*3000,now(),job.id.to_string()]).map_err(failure)?;
    queries::event(&tx, job.id, status)?;
    tx.commit().map_err(failure)?;
    if let Some(code) = error {
        tracing::warn!(job_id = %job.id, attempt = job.attempt, status, error_code = %code, "document processing outcome");
    }
    Ok(())
}
pub(super) fn command(
    db: &mut rusqlite::Connection,
    id: Uuid,
    expected: i64,
    key: Uuid,
    action: String,
) -> Result<Job, Error> {
    let tx = db.transaction().map_err(failure)?;
    let job = queries::get(&tx, id)?;
    queries::visible(&tx, &job.kind, job.item_id)?;
    let old: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT job_id,expected_version,action FROM document_job_commands WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some(old) = old {
        if old != (id.to_string(), expected, action) {
            return Err(Error::Idempotency);
        }
        return Ok(job);
    }
    if job.version != expected {
        return Err(Error::Conflict);
    }
    let status = match action.as_str() {
        "cancel"
            if [
                "queued",
                "extracting",
                "classifying",
                "waiting_configuration",
            ]
            .contains(&job.status.as_str()) =>
        {
            "cancelled"
        }
        "retry" if ["failed", "cancelled"].contains(&job.status.as_str()) => "queued",
        _ => return Err(Error::Conflict),
    };
    tx.execute("UPDATE document_jobs SET status=?,version=version+1,attempt=CASE WHEN ?='retry' THEN 0 ELSE attempt END,lease=NULL,lease_until=NULL,retry_at=0,error_code=NULL,updated_at=? WHERE id=?",params![status,action,now(),id.to_string()]).map_err(failure)?;
    tx.execute(
        "INSERT INTO document_job_commands VALUES(?,?,?,?)",
        params![key.to_string(), id.to_string(), expected, action],
    )
    .map_err(failure)?;
    queries::event(&tx, id, status)?;
    let result = queries::get(&tx, id)?;
    tx.commit().map_err(failure)?;
    tracing::info!(job_id = %id, %action, status, "document command accepted");
    Ok(result)
}
pub(super) fn save_settings(
    db: &mut rusqlite::Connection,
    expected: i64,
    connection: Option<Uuid>,
) -> Result<Settings, Error> {
    let tx = db.transaction().map_err(failure)?;
    if queries::settings(&tx)?.version != expected {
        return Err(Error::Conflict);
    }
    if let Some(id) = connection {
        let valid = decision_config(&tx, Some(id))?.is_some();
        if !valid {
            return Err(Error::Invalid(
                "활성화된 구조화 LLM 또는 System One 연결을 선택하세요.",
            ));
        }
    }
    super::super::decision_settings::write(&tx, connection).map_err(failure)?;
    let result = queries::settings(&tx)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}

fn decision_config(
    db: &rusqlite::Connection,
    connection: Option<Uuid>,
) -> Result<Option<String>, Error> {
    super::super::decision_settings::resolve(db, connection.map(|id| id.to_string()))
        .map_err(failure)
}
