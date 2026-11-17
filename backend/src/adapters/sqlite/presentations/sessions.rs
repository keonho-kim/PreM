// Purpose: Own disposable editor caches without creating user authentication or durable history.
// Pattern: Explicit close, bounded idle TTL, project/deck binding and cascading cache cleanup.
// Usage: Editor mount/heartbeat/leave plus owned worker maintenance and process shutdown.
// Related: history.rs, V22 migration, use-editor-session.ts.
use super::*;
const IDLE_MS: i64 = 30 * 60 * 1000;
pub(super) fn expire(db: &rusqlite::Connection, all: bool) -> Result<(), Error> {
    db.execute(
        "DELETE FROM presentation_editor_sessions WHERE ? OR expires_at<=?",
        params![all, now()],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn require(
    db: &rusqlite::Connection,
    p: Uuid,
    deck: &str,
    id: Uuid,
) -> Result<String, Error> {
    db.query_row("SELECT head_revision_id FROM presentation_editor_sessions WHERE id=? AND project_id=? AND presentation_id=? AND expires_at>?",params![id.to_string(),p.to_string(),deck,now()],|r|r.get(0)).optional().map_err(failure)?.ok_or(Error::HistoryUnavailable)
}
pub(super) fn open(
    db: &mut rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    id: Uuid,
) -> Result<Uuid, Error> {
    let tx = db.transaction().map_err(failure)?;
    expire(&tx, false)?;
    preparation::project(&tx, p, false)?;
    let r = queries::run(&tx, p, &run.to_string())?;
    if r.status != "succeeded" {
        return Err(Error::NotReady);
    }
    let count: i64 = tx
        .query_row(
            "SELECT count(*) FROM presentation_editor_sessions",
            [],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if count >= 1000 {
        return Err(Error::Busy);
    }
    let old: Option<(String, String)> = tx
        .query_row(
            "SELECT project_id,presentation_id FROM presentation_editor_sessions WHERE id=?",
            [id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some(old) = old {
        if old != (p.to_string(), r.presentation_id.to_string()) {
            return Err(Error::Idempotency);
        }
    } else {
        tx.execute(
            "INSERT INTO presentation_editor_sessions VALUES(?,?,?,?,?)",
            params![
                id.to_string(),
                p.to_string(),
                r.presentation_id.to_string(),
                run.to_string(),
                now() + IDLE_MS
            ],
        )
        .map_err(failure)?;
    }
    tx.commit().map_err(failure)?;
    Ok(id)
}
pub(super) fn touch(db: &rusqlite::Connection, p: Uuid, id: Uuid) -> Result<(), Error> {
    expire(db, false)?;
    if db.execute("UPDATE presentation_editor_sessions SET expires_at=? WHERE id=? AND project_id=? AND expires_at>?",params![now()+IDLE_MS,id.to_string(),p.to_string(),now()]).map_err(failure)?!=1{return Err(Error::HistoryUnavailable)}
    Ok(())
}
pub(super) fn close(db: &rusqlite::Connection, p: Uuid, id: Uuid) -> Result<(), Error> {
    db.execute(
        "DELETE FROM presentation_editor_sessions WHERE id=? AND project_id=?",
        params![id.to_string(), p.to_string()],
    )
    .map_err(failure)?;
    Ok(())
}
