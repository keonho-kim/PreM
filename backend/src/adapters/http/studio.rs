// Purpose: Expose project-source readiness and explicit version-bound confirmation.
// Pattern: Thin typed HTTP adapter; source versions and completion are validated server-side.
// Usage: Studio source step, shared across browser contexts.
// Related: modules/studio/, adapters/sqlite/studio.rs.
use crate::modules::studio::{Error, Studio};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use uuid::Uuid;
pub(super) fn router(service: Studio) -> Router {
    Router::new()
        .route(
            "/api/v1/projects/{id}/source-review",
            get(read).put(confirm),
        )
        .layer(DefaultBodyLimit::max(4096))
        .with_state(service)
}
fn response(result: Result<crate::modules::studio::State, Error>) -> Response {
    match result {
        Ok(v) => ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response(),
        Err(e) => {
            let status = match e {
                Error::NotFound => StatusCode::NOT_FOUND,
                Error::Conflict => StatusCode::CONFLICT,
                Error::NotReady => StatusCode::UNPROCESSABLE_ENTITY,
                Error::Storage => StatusCode::SERVICE_UNAVAILABLE,
            };
            (
                status,
                Json(serde_json::json!({"code":"source_review_error","message":e.to_string()})),
            )
                .into_response()
        }
    }
}
async fn read(State(s): State<Studio>, Path(id): Path<Uuid>) -> Response {
    response(s.state(id, None).await)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Confirm {
    snapshot: String,
}
async fn confirm(
    State(s): State<Studio>,
    Path(id): Path<Uuid>,
    Json(c): Json<Confirm>,
) -> Response {
    response(s.state(id, Some(c.snapshot)).await)
}
