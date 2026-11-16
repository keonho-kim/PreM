// Purpose: Expose version-checked provider administration and explicit diagnostics.
// Pattern: Public DTOs omit secrets; saved settings and model requests remain separate.
// Usage: Admin frontend under /api/v1/admin/llm/providers, without account gates.
// Related: model_registry, inference, frontend/features/providers/.
use crate::modules::{
    inference::{self, Diagnostics, Inference, RequestRecord, TestKind},
    model_registry::{self, Provider, Registry, Settings},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct ProviderApi {
    pub execution: crate::modules::model_execution::Execution,
    pub decisions: crate::modules::decisions::Decisions,
    pub registry: Registry,
    pub inference: Inference,
    pub diagnostics: Diagnostics,
}
pub(super) fn router(api: ProviderApi) -> Router {
    Router::new()
        .route(
            "/api/v1/models/authoring",
            get(super::authoring_models::list),
        )
        .route(
            "/api/v1/admin/llm/provider-types",
            get(super::provider_catalog::list),
        )
        .route(
            "/api/v1/admin/llm/models/discover",
            axum::routing::post(super::model_discovery::discover),
        )
        .route("/api/v1/admin/llm/providers", get(list))
        .route("/api/v1/admin/llm/providers/{id}", get(detail).put(save))
        .route("/api/v1/admin/llm/providers/{id}/models", get(models))
        .route(
            "/api/v1/admin/llm/providers/{id}/test",
            axum::routing::post(test),
        )
        .route("/api/v1/admin/llm/providers/{id}/requests", get(history))
        .route(
            "/api/v1/admin/llm/providers/{id}/capacity",
            get(super::model_capacity::get).put(super::model_capacity::save),
        )
        .route(
            "/api/v1/admin/decisions/{id}/evaluate",
            axum::routing::post(super::decisions::evaluate),
        )
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(api)
}
#[derive(Serialize)]
struct ProviderDto {
    id: Uuid,
    config_id: Uuid,
    version: i64,
    name: String,
    provider_type: String,
    base_url: String,
    model_identifier: String,
    timeout_seconds: u32,
    enabled: bool,
    has_secret: bool,
    created_at: i64,
}
impl From<Provider> for ProviderDto {
    fn from(p: Provider) -> Self {
        let s = p.settings;
        Self {
            id: p.id,
            config_id: p.config_id,
            version: p.version,
            name: s.name,
            provider_type: s.provider_type.as_str().into(),
            base_url: s.base_url,
            model_identifier: s.model_identifier,
            timeout_seconds: s.timeout_seconds,
            enabled: s.enabled,
            has_secret: p.encrypted_secret.is_some(),
            created_at: p.created_at,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveBody {
    expected_version: i64,
    name: String,
    provider_type: String,
    base_url: String,
    model_identifier: String,
    timeout_seconds: u32,
    enabled: bool,
    api_key: Option<String>,
    #[serde(default)]
    clear_secret: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    expected_version: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TestBody {
    expected_version: i64,
    kind: String,
}
#[derive(Serialize)]
pub(super) struct RecordDto {
    id: Uuid,
    config_id: Uuid,
    kind: String,
    status: String,
    elapsed_ms: Option<i64>,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    error_code: Option<String>,
    created_at: i64,
}
impl From<RequestRecord> for RecordDto {
    fn from(r: RequestRecord) -> Self {
        Self {
            id: r.id,
            config_id: r.config_id,
            kind: r.kind,
            status: r.status,
            elapsed_ms: r.elapsed_ms,
            prompt_tokens: r.prompt_tokens,
            completion_tokens: r.completion_tokens,
            error_code: r.error_code,
            created_at: r.created_at,
        }
    }
}
pub(super) struct ApiError(inference::Error);
impl From<model_registry::Error> for ApiError {
    fn from(e: model_registry::Error) -> Self {
        Self(e.into())
    }
}
impl From<inference::Error> for ApiError {
    fn from(e: inference::Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        use inference::Error as I;
        use model_registry::Error as R;
        let (status, code) = match &self.0 {
            I::Registry(R::Invalid(_)) => (StatusCode::BAD_REQUEST, "invalid_input"),
            I::Registry(R::NotFound) => (StatusCode::NOT_FOUND, "not_found"),
            I::Registry(R::Conflict) => (StatusCode::CONFLICT, "revision_conflict"),
            I::Registry(R::Unavailable | R::Secret) | I::Storage => {
                (StatusCode::SERVICE_UNAVAILABLE, "storage_unavailable")
            }
            I::Unsupported(_) => (StatusCode::UNPROCESSABLE_ENTITY, self.0.code()),
            I::Busy => (StatusCode::TOO_MANY_REQUESTS, self.0.code()),
            I::Timeout | I::QueueTimeout => (StatusCode::GATEWAY_TIMEOUT, self.0.code()),
            I::Cancelled => (StatusCode::SERVICE_UNAVAILABLE, self.0.code()),
            _ => (StatusCode::BAD_GATEWAY, self.0.code()),
        };
        json(
            status,
            serde_json::json!({"code":code,"message":self.0.to_string()}),
        )
    }
}
pub(super) fn json(status: StatusCode, value: impl Serialize) -> Response {
    (status, [("Cache-Control", "no-store")], Json(value)).into_response()
}
pub(super) fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    value
        .map(|v| v.0)
        .map_err(|_| model_registry::Error::Invalid("JSON 요청 필드를 확인하세요.").into())
}
async fn list(State(api): State<ProviderApi>) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        api.registry
            .list()
            .await?
            .into_iter()
            .map(ProviderDto::from)
            .collect::<Vec<_>>(),
    ))
}
async fn detail(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        ProviderDto::from(api.registry.get(id).await?),
    ))
}
async fn save(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<SaveBody>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body(input)?;
    let p = api
        .registry
        .save(
            id,
            b.expected_version,
            Settings {
                name: b.name,
                provider_type: b.provider_type.parse()?,
                base_url: b.base_url,
                model_identifier: b.model_identifier,
                timeout_seconds: b.timeout_seconds,
                enabled: b.enabled,
            },
            b.api_key,
            b.clear_secret,
        )
        .await?;
    Ok(json(StatusCode::OK, ProviderDto::from(p)))
}
async fn models(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    Query(q): Query<Version>,
) -> Result<Response, ApiError> {
    let p = api.registry.get(id).await?;
    let models = if p.settings.provider_type.is_system() {
        api.decisions.models(id, q.expected_version).await?
    } else {
        api.inference.models(id, q.expected_version).await?
    };
    Ok(json(StatusCode::OK, models))
}
async fn test(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<TestBody>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body(input)?;
    let kind = match b.kind.as_str() {
        "text" => TestKind::Text,
        "structured" => TestKind::Structured,
        _ => {
            return Err(model_registry::Error::Invalid(
                "text 또는 structured 테스트를 선택하세요.",
            )
            .into());
        }
    };
    let result = api.diagnostics.test(id, b.expected_version, kind).await?;
    Ok(json(
        StatusCode::OK,
        serde_json::json!({"request":RecordDto::from(result.record),"text":result.text}),
    ))
}
async fn history(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    api.registry.get(id).await?;
    Ok(json(
        StatusCode::OK,
        api.inference
            .history(id)
            .await?
            .into_iter()
            .map(RecordDto::from)
            .collect::<Vec<_>>(),
    ))
}
