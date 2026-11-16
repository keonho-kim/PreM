// Purpose: Record idempotent upload attempts, cancellation outcomes and atomic registrations.
// Pattern: Blob publication precedes a single receipt/file/library transaction.
// Usage: HTTP begins an attempt, then registers or records a failure; cancellation is serialized.
// Related: queries.rs, writes.rs, modules/libraries/ports.rs.
use super::*;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
type UploadBinding = (
    Option<String>,
    Option<String>,
    Option<i64>,
    String,
    Option<String>,
);
pub(super) fn status(db: &Connection, key: Uuid) -> Result<UploadStatus, Error> {
    db.query_row("SELECT u.state,coalesce(r.item_id,t.item_id,s.item_id) FROM upload_requests u LEFT JOIN reference_versions r ON r.id=u.reference_version_id LEFT JOIN template_versions t ON t.id=u.template_version_id LEFT JOIN source_versions s ON s.id=u.source_version_id WHERE u.request_key=?1",[key.to_string()],|r|Ok(UploadStatus{state:r.get(0)?,item_id:r.get(1)?})).optional().map_err(storage)?.ok_or(Error::NotFound)
}
pub(super) fn begin(db: &mut Connection, u: Upload, now: i64) -> Result<(), Error> {
    queries::scope(db, u.kind, true)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let old: Option<UploadBinding>=tx.query_row("SELECT kind,target_id,expected_version,state,project_id FROM upload_requests WHERE request_key=?1",[u.key.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(storage)?;
    if let Some((kind, target, expected, state, project)) = old {
        if state == "cancelled" {
            return Err(Error::Cancelled);
        }
        if kind.as_deref() != Some(u.kind.prefix())
            || target != u.target.map(|id| id.to_string())
            || expected != u.expected_version
            || project != u.kind.project().map(|p| p.to_string())
        {
            return Err(Error::IdempotencyConflict);
        }
        if state == "complete" {
            return Ok(());
        }
        if state == "receiving" {
            return Err(Error::InProgress);
        }
        tx.execute(
            "UPDATE upload_requests SET state='receiving',attempt=?1 WHERE request_key=?2",
            params![u.attempt.to_string(), u.key.to_string()],
        )
        .map_err(storage)?;
    } else {
        tx.execute("INSERT INTO upload_requests(request_key,kind,target_id,expected_version,attempt,state,created_at,project_id) VALUES(?1,?2,?3,?4,?5,'receiving',?6,?7)",params![u.key.to_string(),u.kind.prefix(),u.target.map(|id|id.to_string()),u.expected_version,u.attempt.to_string(),now,u.kind.project().map(|p|p.to_string())]).map_err(storage)?;
    }
    if let Some(id) = u.target {
        let item = queries::get(&tx, u.kind, id, false)?;
        if Some(item.version) != u.expected_version {
            return Err(Error::Conflict);
        }
    }
    tx.commit().map_err(storage)?;
    Ok(())
}
pub(super) fn cancel(db: &mut Connection, key: Uuid, now: i64) -> Result<UploadStatus, Error> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    tx.execute("INSERT INTO upload_requests(request_key,state,created_at) VALUES(?1,'cancelled',?2) ON CONFLICT(request_key) DO UPDATE SET state=CASE WHEN state='complete' THEN state ELSE 'cancelled' END",params![key.to_string(),now]).map_err(storage)?;
    let result = status(&tx, key)?;
    tx.commit().map_err(storage)?;
    Ok(result)
}
pub(super) fn register(db: &mut Connection, r: Register) -> Result<Saved, Error> {
    queries::scope(db, r.upload.kind, true)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let u = &r.upload;
    let p = u.kind.prefix();
    let fingerprint = serde_json::to_string(&(
        p,
        u.target,
        u.expected_version,
        &r.title,
        &r.tags,
        &r.filename,
        &r.blob.sha256,
    ))
    .map_err(|_| Error::Storage)?;
    let (state, attempt, old): (String, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT state,attempt,fingerprint FROM upload_requests WHERE request_key=?1",
            [u.key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(storage)?;
    if state == "complete" {
        if old.as_deref() != Some(&fingerprint) {
            return Err(Error::IdempotencyConflict);
        }
        let id = status(&tx, u.key)?.item_id.ok_or(Error::Storage)?;
        return Ok(Saved {
            item: queries::get(
                &tx,
                u.kind,
                Uuid::parse_str(&id).map_err(|_| Error::Storage)?,
                false,
            )?,
            replayed: true,
        });
    }
    if state == "cancelled" {
        return Err(Error::Cancelled);
    }
    if state != "receiving" || attempt.as_deref() != Some(&u.attempt.to_string()) {
        return Err(Error::Conflict);
    }
    let id = u.target.unwrap_or_else(Uuid::new_v4);
    let number = if u.target.is_some() {
        let item = queries::get(&tx, u.kind, id, false)?;
        if Some(item.version) != u.expected_version {
            return Err(Error::Conflict);
        }
        item.file_version.checked_add(1).ok_or(Error::Storage)?
    } else {
        1
    };
    tx.execute("INSERT OR IGNORE INTO file_blobs(sha256,size_bytes,detected_mime,format,created_at) VALUES(?1,?2,?3,?4,?5)",params![r.blob.sha256,i64::try_from(r.blob.size).map_err(|_|Error::Storage)?,r.blob.format.mime(),r.blob.format.extension(),r.now]).map_err(storage)?;
    let registration = Uuid::new_v4().to_string();
    let file_version = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO file_registrations(id,blob_sha256,original_filename,created_at) VALUES(?1,?2,?3,?4)",params![registration,r.blob.sha256,r.filename,r.now]).map_err(storage)?;
    if u.target.is_none() {
        let insert = if u.kind.project().is_some() {
            format!(
                "INSERT INTO {p}_items(id,title,created_at,updated_at,project_id) VALUES(?1,?2,?3,?3,?4)"
            )
        } else {
            format!(
                "INSERT INTO {p}_items(id,title,created_at,updated_at) SELECT ?1,?2,?3,?3 WHERE ?4 IS NULL"
            )
        };
        tx.execute(
            &insert,
            params![
                id.to_string(),
                r.title,
                r.now,
                u.kind.project().map(|p| p.to_string())
            ],
        )
        .map_err(storage)?;
    }
    tx.execute(&format!("INSERT INTO {p}_versions(id,item_id,number,file_registration_id,created_at) VALUES(?1,?2,?3,?4,?5)"),params![file_version,id.to_string(),number,registration,r.now]).map_err(storage)?;
    tx.execute(&format!("UPDATE {p}_items SET current_version_id=?1,title=?2,version=version+?3,updated_at=max(updated_at,?4) WHERE id=?5"),params![file_version,r.title,if u.target.is_some(){1}else{0},r.now,id.to_string()]).map_err(storage)?;
    writes::set_tags(&tx, u.kind, id, &r.tags)?;
    tx.execute(&format!("UPDATE upload_requests SET state='complete',fingerprint=?1,{p}_version_id=?2 WHERE request_key=?3"),params![fingerprint,file_version,u.key.to_string()]).map_err(storage)?;
    let item = queries::get(&tx, u.kind, id, false)?;
    tx.commit().map_err(storage)?;
    Ok(Saved {
        item,
        replayed: false,
    })
}

pub(in crate::adapters::sqlite) fn recover_interrupted(db: &Connection) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE upload_requests SET state='failed' WHERE state='receiving'",
        [],
    )?;
    Ok(())
}
