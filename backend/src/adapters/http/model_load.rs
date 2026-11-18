// Purpose: Prepare the saved LM Studio model on an explicit version-checked Admin request.
// Pattern: One load at a time per server; rechecking inventory makes completed requests reusable.
// Usage: POST providers/{id}/prepare; loading never unloads other instances.
// Related: model_http/lm_load.rs, providers.rs, frontend/features/providers/model-token-fields.tsx.
use super::providers::{ApiError, ProviderApi, body, json};
use crate::adapters::model_http::{Transport, lm_load};
use crate::modules::model_execution::Error;
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct ModelLoader {
    transport: Transport,
    slot: Arc<Semaphore>,
}
impl ModelLoader {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            transport: Transport::new()?,
            slot: Arc::new(Semaphore::new(1)),
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Prepare {
    expected_version: i64,
}
pub(super) async fn prepare(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<Prepare>, JsonRejection>,
) -> Result<Response, ApiError> {
    let version = body(input)?.expected_version;
    let loader = api.model_loader;
    let _slot = loader.slot.try_acquire().map_err(|_| Error::Busy)?;
    let instance = api
        .execution
        .query(id, version, move |c| {
            Box::pin(async move { lm_load::prepare(&loader.transport, c).await })
        })
        .await?;
    Ok(json(
        StatusCode::OK,
        serde_json::json!({"instance_id":instance}),
    ))
}
