// Purpose: Discover native provider models using temporary or retained connection credentials.
// Pattern: POST keeps keys out of URLs; version-checked input has no persistence side effects.
// Usage: Admin calls before selecting a model and saving its connection.
// Related: providers.rs, model_registry/discovery.rs, model_execution/mod.rs.
use super::providers::{ApiError, ProviderApi, body, json};
use crate::modules::model_registry::DiscoveryInput;
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Input {
    connection_id: Option<Uuid>,
    expected_version: Option<i64>,
    provider_type: String,
    base_url: Option<String>,
    api_key: Option<String>,
    #[serde(default)]
    clear_secret: bool,
}
pub(super) async fn discover(
    State(api): State<ProviderApi>,
    input: Result<Json<Input>, JsonRejection>,
) -> Result<Response, ApiError> {
    let input = body(input)?;
    let request = DiscoveryInput {
        connection_id: input.connection_id,
        expected_version: input.expected_version,
        kind: input.provider_type.parse()?,
        base_url: input.base_url,
        api_key: input.api_key,
        clear_secret: input.clear_secret,
    };
    let models = if request.kind.is_system() {
        api.decisions.discover(request).await?
    } else {
        api.inference.discover(request).await?
    };
    Ok(json(StatusCode::OK, models))
}
