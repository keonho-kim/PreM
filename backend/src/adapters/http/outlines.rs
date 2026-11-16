// Purpose: Expose versioned outline editing, source mapping and explicit durable generation.
// Pattern: Typed bounded commands, idempotency keys and no-store shared state.
// Usage: Studio's outline/content step; historical reads never mutate current revisions.
// Related: modules/outlines/, frontend/features/outlines/.
use crate::modules::outlines::{Edit, Error, Generate, Outlines};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
pub(super) fn router(s: Outlines) -> Router {
    Router::new()
        .route("/api/v1/projects/{project}/outline", get(state).put(save))
        .route(
            "/api/v1/projects/{project}/outline/confirm",
            axum::routing::post(confirm),
        )
        .route(
            "/api/v1/projects/{project}/outline/revisions",
            get(revisions),
        )
        .route(
            "/api/v1/projects/{project}/outline/revisions/{revision}",
            get(revision),
        )
        .route("/api/v1/projects/{project}/outline/blocks", get(blocks))
        .route(
            "/api/v1/projects/{project}/outline/runs",
            axum::routing::post(create),
        )
        .route(
            "/api/v1/projects/{project}/outline/runs/{id}/{action}",
            axum::routing::post(command),
        )
        .layer(DefaultBodyLimit::max(1024 * 1024))
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
        let status = match self.0 {
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Conflict | Error::Idempotency | Error::Busy => StatusCode::CONFLICT,
            Error::Storage => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::UNPROCESSABLE_ENTITY,
        };
        json(
            status,
            serde_json::json!({"code":"outline_error","message":self.0.to_string()}),
        )
    }
}
fn json(status: StatusCode, value: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
fn body<T>(input: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    input.map(|Json(v)| v).map_err(|_| Error::Invalid.into())
}
fn key(h: &HeaderMap) -> Result<Uuid, ApiError> {
    h.get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or(Error::Invalid.into())
}
async fn state(State(s): State<Outlines>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.state(p, None).await?))
}
async fn save(
    State(s): State<Outlines>,
    Path(p): Path<Uuid>,
    input: Result<Json<Edit>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.save(p, body(input)?).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    expected_version: i64,
}
async fn confirm(
    State(s): State<Outlines>,
    Path(p): Path<Uuid>,
    input: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.confirm(p, body(input)?.expected_version).await?,
    ))
}
async fn revisions(State(s): State<Outlines>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.revisions(p).await?))
}
async fn revision(
    State(s): State<Outlines>,
    Path((p, r)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.state(p, Some(r)).await?))
}
#[derive(Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
struct BlockQuery {
    revision: Option<Uuid>,
    q: String,
    offset: u32,
    ids: Option<String>,
}
async fn blocks(
    State(s): State<Outlines>,
    Path(p): Path<Uuid>,
    Query(q): Query<BlockQuery>,
) -> Result<Response, ApiError> {
    let ids = q
        .ids
        .map(|s| {
            s.split(',')
                .map(Uuid::parse_str)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
        .map_err(|_| ApiError(Error::Invalid))?;
    Ok(json(
        StatusCode::OK,
        s.blocks(p, q.revision, q.q, q.offset, ids).await?,
    ))
}
async fn create(
    State(s): State<Outlines>,
    Path(p): Path<Uuid>,
    h: HeaderMap,
    input: Result<Json<Generate>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.create(p, key(&h)?, body(input)?).await?,
    ))
}
async fn command(
    State(s): State<Outlines>,
    Path((p, id, action)): Path<(Uuid, Uuid, String)>,
    h: HeaderMap,
    input: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.command(p, id, key(&h)?, body(input)?.expected_version, action)
            .await?,
    ))
}
