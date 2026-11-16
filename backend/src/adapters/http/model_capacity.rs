// Purpose: Expose shared request capacity settings and live counts for both AI connection categories.
// Pattern: Version-conditional writes; no provider credentials or inference-engine mutation.
// Usage: Admin connection detail capacity tab.
// Related: providers.rs, modules/model_execution/capacity.rs, frontend/features/providers/.
use super::providers::{ApiError, ProviderApi, body, json};
use crate::modules::model_execution::Limits;
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;
pub(super) async fn get(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, api.execution.capacity(id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Save {
    expected_version: i64,
    max_parallel: u32,
    queue_capacity: u32,
    queue_timeout_seconds: u32,
}
pub(super) async fn save(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<Save>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body(input)?;
    Ok(json(
        StatusCode::OK,
        api.execution
            .save_capacity(
                id,
                b.expected_version,
                Limits {
                    max_parallel: b.max_parallel,
                    queue_capacity: b.queue_capacity,
                    queue_timeout_seconds: b.queue_timeout_seconds,
                },
            )
            .await?,
    ))
}
