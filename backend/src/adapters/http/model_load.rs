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
    pub(super) async fn prepare_draft(
        &self,
        c: crate::modules::model_registry::Credentials,
    ) -> Result<String, Error> {
        let _slot = self.slot.try_acquire().map_err(|_| Error::Busy)?;
        lm_load::prepare(&self.transport, c).await
    }
    pub(super) async fn reasoning_options(
        &self,
        mut c: crate::modules::model_registry::Credentials,
    ) -> Result<Option<Vec<String>>, Error> {
        use crate::adapters::model_http::{bearer, lm_studio_models::native_url, read};
        c.base_url = native_url(&c)?;
        let inventory = read(bearer(&self.transport, &c, "models", false)?.send().await).await?;
        let model = inventory["models"].as_array().and_then(|models| {
            models.iter().find(|m| {
                m["key"] == c.model_identifier
                    || m["loaded_instances"]
                        .as_array()
                        .is_some_and(|xs| xs.iter().any(|x| x["id"] == c.model_identifier))
            })
        });
        Ok(model
            .and_then(|m| m.pointer("/capabilities/reasoning/allowed_options"))
            .and_then(|v| v.as_array())
            .map(|xs| {
                xs.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| matches!(*s, "on" | "off" | "low" | "medium" | "high" | "xhigh"))
                    .map(str::to_owned)
                    .collect()
            }))
    }
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
