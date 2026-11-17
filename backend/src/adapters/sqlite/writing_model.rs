// Purpose: Resolve enabled writing connections without duplicating provider classification rules.
// Pattern: Read-only canonical registry projection inside the consumer admission transaction.
// Usage: Outline and presentation adapters pin the returned immutable configuration ID.
// Related: providers.rs, modules/model_registry/kind.rs.
use crate::modules::model_registry::ProviderKind;
use rusqlite::{Connection, params};
use uuid::Uuid;
pub(super) fn resolve(
    db: &Connection,
    connection: Option<Uuid>,
    version: Option<i64>,
) -> rusqlite::Result<Option<String>> {
    let mut stmt = db.prepare("SELECT v.id,v.provider_type,v.version FROM llm_provider_connections c JOIN llm_provider_config_versions v ON v.id=c.current_config_version_id JOIN llm_provider_config_versions first ON first.connection_id=c.id AND first.version=1 WHERE v.enabled=1 AND (?1 IS NULL OR c.id=?1) ORDER BY first.created_at,c.id")?;
    let rows = stmt.query_map(params![connection.map(|id| id.to_string())], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (id, kind, v) = row?;
        if kind.parse::<ProviderKind>().is_ok_and(|k| !k.is_system())
            && version.is_none_or(|expected| expected == v)
        {
            return Ok(Some(id));
        }
    }
    Ok(None)
}
