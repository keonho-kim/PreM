// Purpose: Expose durable relation searches, model settings and version-pinned source choices.
// Pattern: Typed bounded HTTP input; normal responses exclude model prompts and credentials.
// Usage: Studio past-material search and Admin's search model selection.
// Related: modules/relations/, frontend/features/related-documents/.
use crate::modules::relations::{Error, Relations, Search, SelectItem, Settings};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
pub(super) fn router(s: Relations) -> Router {
    Router::new()
        .route(
            "/api/v1/projects/{project}/related-searches",
            get(latest).post(create),
        )
        .route(
            "/api/v1/projects/{project}/related-searches/{id}",
            get(detail),
        )
        .route(
            "/api/v1/projects/{project}/related-searches/{id}/results",
            get(results),
        )
        .route(
            "/api/v1/projects/{project}/related-searches/{id}/{action}",
            axum::routing::post(command),
        )
        .route(
            "/api/v1/projects/{project}/related-candidates/{id}/origins",
            get(origins),
        )
        .route(
            "/api/v1/projects/{project}/related-candidates/{id}/evidence",
            get(evidence),
        )
        .route(
            "/api/v1/projects/{project}/related-items",
            get(selections).put(select),
        )
        .route(
            "/api/v1/admin/related-search/settings",
            get(settings).put(save_settings),
        )
        .layer(DefaultBodyLimit::max(4096))
        .with_state(s)
}
struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self.0 {
            Error::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Error::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
            Error::Idempotency => (StatusCode::CONFLICT, "idempotency_conflict"),
            Error::Invalid | Error::NotReady | Error::SourceLimit | Error::SelectionLimit => {
                (StatusCode::UNPROCESSABLE_ENTITY, "invalid_search")
            }
            _ => (StatusCode::SERVICE_UNAVAILABLE, "search_unavailable"),
        };
        json(
            status,
            serde_json::json!({"code":code,"message":self.0.to_string()}),
        )
    }
}
fn json(status: StatusCode, value: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
fn key(h: &HeaderMap) -> Result<Uuid, ApiError> {
    h.get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or(Error::Invalid.into())
}
fn body<T>(input: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    input.map(|Json(v)| v).map_err(|_| Error::Invalid.into())
}
async fn create(
    State(s): State<Relations>,
    Path(p): Path<Uuid>,
    h: HeaderMap,
    b: Result<Json<Search>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.create(p, key(&h)?, body(b)?).await?,
    ))
}
async fn latest(State(s): State<Relations>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.get(p, None).await?))
}
async fn detail(
    State(s): State<Relations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.get(p, Some(id)).await?.ok_or(Error::NotFound)?,
    ))
}
#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    offset: u32,
    #[serde(default = "file_kind")]
    kind: String,
}
fn file_kind() -> String {
    "file".into()
}
async fn results(
    State(s): State<Relations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    Query(q): Query<Page>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.results(p, id, q.kind, q.offset).await?,
    ))
}
async fn origins(
    State(s): State<Relations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    Query(q): Query<Page>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.origins(p, id, q.offset).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    expected_version: i64,
}
async fn command(
    State(s): State<Relations>,
    Path((p, id, a)): Path<(Uuid, Uuid, String)>,
    h: HeaderMap,
    b: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.command(p, id, body(b)?.expected_version, key(&h)?, a)
            .await?,
    ))
}
async fn settings(State(s): State<Relations>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.settings(None).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configure {
    expected_version: i64,
    connection_id: Option<Uuid>,
    planner_connection_id: Option<Uuid>,
}
async fn save_settings(
    State(s): State<Relations>,
    b: Result<Json<Configure>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body(b)?;
    Ok(json(
        StatusCode::OK,
        s.settings(Some(Settings {
            version: b.expected_version,
            connection_id: b.connection_id,
            planner_connection_id: b.planner_connection_id,
        }))
        .await?,
    ))
}
async fn select(
    State(s): State<Relations>,
    Path(p): Path<Uuid>,
    b: Result<Json<SelectItem>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.select(p, body(b)?).await?))
}
async fn selections(State(s): State<Relations>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.selections(p).await?))
}

async fn evidence(
    State(s): State<Relations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.evidence(p, id).await?))
}
