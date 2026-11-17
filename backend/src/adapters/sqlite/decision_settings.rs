// Purpose: Own writes to the shared document and relation decision selection.
// Pattern: Callers hold short transactions and validate their expected selection version.
// Usage: Document and legacy relation settings delegate their common selection commit here.
// Related: V33__shared_decision_settings.sql, documents/jobs.rs, relations/settings.rs.
use rusqlite::Connection;
use uuid::Uuid;
pub(super) fn write(db: &Connection, id: Option<Uuid>) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE decision_settings SET connection_id=?,version=version+1 WHERE id=1",
        [id.map(|v| v.to_string())],
    )?;
    Ok(())
}
