// Purpose: List enabled writing models without exposing Admin connection configuration.
// Pattern: Public allowlisted DTO; registry remains the sole configuration owner.
// Usage: Studio outline and presentation model selectors work without Admin access.
// Related: providers.rs, modules/model_registry/, frontend/features/providers/authoring-api.ts.
use super::providers::{ApiError, ProviderApi, json};
use axum::{extract::State, http::StatusCode, response::Response};
use serde::Serialize;
use uuid::Uuid;
#[derive(Serialize)]
struct Choice {
    id: Uuid,
    name: String,
    model_identifier: String,
    version: i64,
}
pub(super) async fn list(State(api): State<ProviderApi>) -> Result<Response, ApiError> {
    let items = api
        .registry
        .list()
        .await?
        .into_iter()
        .filter(|p| p.settings.enabled && !p.settings.provider_type.is_system())
        .map(|p| Choice {
            id: p.id,
            name: p.settings.name,
            model_identifier: p.settings.model_identifier,
            version: p.version,
        })
        .collect::<Vec<_>>();
    Ok(json(StatusCode::OK, items))
}
