// Purpose: Expose explicit decision evaluation independently of text diagnostics.
// Pattern: Version-pinned provider reference, bounded batch parsing and safe output projection.
// Usage: Admin sends only its reviewed sample; this never reads uploaded documents.
// Related: modules/decisions/, providers.rs, frontend/features/providers/decision-checks.tsx.
use super::providers::{ApiError, ProviderApi, RecordDto, body, json};
use crate::modules::decisions::Batch;
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EvaluateBody {
    expected_version: i64,
    batch: Batch,
}
pub(super) async fn evaluate(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<EvaluateBody>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body(input)?;
    let (result, record) = api
        .decisions
        .evaluate(id, b.expected_version, b.batch)
        .await?;
    Ok(json(
        StatusCode::OK,
        serde_json::json!({"result":result,"request":RecordDto::from(record)}),
    ))
}
