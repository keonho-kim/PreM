// Purpose: Adapt legacy relation settings to the shared decision selection.
// Pattern: Version-checked configuration; running searches retain their pinned provider revision.
// Usage: Admin selects an existing Decision connection or structured LLM bridge.
// Related: lifecycle.rs, modules/model_registry/.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn config(db: &rusqlite::Connection, id: Option<Uuid>) -> Result<Option<String>, Error> {
    let Some(id) = id else { return Ok(None) };
    let row:Option<(String,String,bool)>=db.query_row("SELECT c.id,c.provider_type,c.enabled FROM llm_provider_connections p JOIN llm_provider_config_versions c ON c.id=p.current_config_version_id WHERE p.id=?",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?;
    match row {
        Some((id, kind, true)) => {
            let kind: crate::modules::model_registry::ProviderKind =
                kind.parse().map_err(|_| Error::Storage)?;
            Ok((kind.is_system() || kind.descriptor().structured).then_some(id))
        }
        _ => Ok(None),
    }
}
pub(super) fn read(db: &rusqlite::Connection) -> Result<Settings, Error> {
    let (version, id, planner): (i64, Option<String>, Option<String>) = db
        .query_row(
            "SELECT d.version,d.connection_id,r.planner_connection_id FROM decision_settings d JOIN relation_settings r ON r.id=d.id WHERE d.id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(failure)?;
    Ok(Settings {
        version,
        connection_id: id.map(uuid).transpose()?,
        planner_connection_id: planner.map(uuid).transpose()?,
    })
}
pub(super) fn save(
    db: &mut rusqlite::Connection,
    edit: Option<Settings>,
) -> Result<Settings, Error> {
    let Some(edit) = edit else { return read(db) };
    let tx = db.transaction().map_err(failure)?;
    if read(&tx)?.version != edit.version {
        return Err(Error::Conflict);
    }
    if edit.connection_id.is_some() && config(&tx, edit.connection_id)?.is_none() {
        return Err(Error::Invalid);
    }
    if edit.planner_connection_id.is_some()
        && planner_config(&tx, edit.planner_connection_id)?.is_none()
    {
        return Err(Error::Invalid);
    }
    tx.execute(
        "UPDATE relation_settings SET version=version+1,planner_connection_id=? WHERE id=1",
        params![edit.planner_connection_id.map(|v| v.to_string())],
    )
    .map_err(failure)?;
    super::super::decision_settings::write(&tx, edit.connection_id).map_err(failure)?;
    let saved = read(&tx)?;
    tx.commit().map_err(failure)?;
    Ok(saved)
}

pub(super) fn planner_config(
    db: &rusqlite::Connection,
    id: Option<Uuid>,
) -> Result<Option<String>, Error> {
    let Some(id) = id else { return Ok(None) };
    let row:Option<(String,String,bool)>=db.query_row("SELECT c.id,c.provider_type,c.enabled FROM llm_provider_connections p JOIN llm_provider_config_versions c ON c.id=p.current_config_version_id WHERE p.id=?",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?;
    match row {
        Some((id, kind, true)) => {
            let kind: crate::modules::model_registry::ProviderKind =
                kind.parse().map_err(|_| Error::Storage)?;
            Ok((!kind.is_system()).then_some(id))
        }
        _ => Ok(None),
    }
}
