// Purpose: Resolve and pin a writing configuration without a public model-selection control.
// Pattern: Read-only registry projection inside generation admission; existing receipts replay first.
// Usage: New decks use the first registered eligible connection; versions retain their connection.
// Related: admission.rs, modules/model_registry/, presentation_models.rs.
use super::*;
use crate::modules::model_registry::ProviderKind;
use rusqlite::Connection;

fn eligible(kind: &str) -> bool {
    kind.parse::<ProviderKind>().is_ok_and(|k| !k.is_system())
}

pub(super) fn resolve(db: &Connection, project: Uuid, input: &Generate) -> Result<String, Error> {
    let preferred = match input.connection_id {
        Some(id) => Some(id.to_string()),
        None => match input.presentation_id {
            Some(deck) => db.query_row(
                "SELECT c.connection_id FROM presentations d JOIN presentation_runs r ON r.id=d.current_revision_id LEFT JOIN llm_provider_config_versions c ON c.id=r.config_id WHERE d.id=? AND d.project_id=?",
                params![deck.to_string(), project.to_string()], |r| r.get::<_, Option<String>>(0),
            ).optional().map_err(failure)?.flatten(),
            None => None,
        },
    };
    if let Some(connection) = preferred {
        let current: Option<(String, String, i64, bool)> = db.query_row(
            "SELECT v.id,v.provider_type,v.version,v.enabled FROM llm_provider_connections c JOIN llm_provider_config_versions v ON v.id=c.current_config_version_id WHERE c.id=?",
            [connection], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).optional().map_err(failure)?;
        let (config, kind, version, enabled) = current.ok_or(Error::WritingModelUnavailable)?;
        if !enabled || !eligible(&kind) {
            return Err(Error::WritingModelUnavailable);
        }
        if input
            .model_version
            .is_some_and(|expected| expected != version)
        {
            return Err(Error::Conflict);
        }
        return Ok(config);
    }
    super::super::writing_model::resolve(db, None, None)
        .map_err(failure)?
        .ok_or(Error::WritingModelUnavailable)
}
