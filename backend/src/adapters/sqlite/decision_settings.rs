// Purpose: Own writes to the shared document and relation decision selection.
// Pattern: Callers hold short transactions and validate their expected selection version.
// Usage: Document and legacy relation settings delegate their common selection commit here.
// Related: V1__baseline.sql, documents/jobs.rs, relations/settings.rs.
use crate::modules::model_registry::ProviderKind;
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;
pub(super) fn write(db: &Connection, id: Option<Uuid>) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE decision_settings SET connection_id=?,version=version+1 WHERE id=1",
        [id.map(|v| v.to_string())],
    )?;
    Ok(())
}

pub(super) fn resolve(
    db: &Connection,
    connection: Option<String>,
) -> rusqlite::Result<Option<String>> {
    let Some(connection) = connection else {
        return Ok(None);
    };
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT v.id, v.provider_type FROM llm_provider_connections c
         JOIN llm_provider_config_versions v ON v.id=c.current_config_version_id
         WHERE c.id=? AND v.enabled=1",
            [connection],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((id, kind)) = row else {
        return Ok(None);
    };
    let kind: ProviderKind = kind.parse().map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok((kind.is_system() || kind.descriptor().structured).then_some(id))
}
