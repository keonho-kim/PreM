// Purpose: Expose optional project direction without coupling edits to generation.
// Pattern: Typed body limits and explicit conflict responses over the guide facade.
// Usage: Studio direction step reads and saves Do/Don't revisions.
// Related: modules/guides/, adapters/sqlite/guides.rs.
use crate::modules::guides::{Edit, Error, Guide, Guides};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use uuid::Uuid;
pub(super) fn router(service: Guides) -> Router {
    Router::new()
        .route("/api/v1/projects/{id}/guide", get(read).put(save))
        .layer(DefaultBodyLimit::max(20000))
        .with_state(service)
}
fn response(result: Result<Guide, Error>) -> Response {
    match result {
        Ok(v) => ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response(),
        Err(e) => {
            let (status, code) = match e {
                Error::NotFound => (StatusCode::NOT_FOUND, "not_found"),
                Error::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
                Error::Invalid => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_guide"),
                Error::Storage => (StatusCode::SERVICE_UNAVAILABLE, "guide_unavailable"),
            };
            (
                status,
                Json(serde_json::json!({"code":code,"message":e.to_string()})),
            )
                .into_response()
        }
    }
}
async fn read(State(s): State<Guides>, Path(id): Path<Uuid>) -> Response {
    response(s.guide(id, None).await)
}
async fn save(State(s): State<Guides>, Path(id): Path<Uuid>, Json(e): Json<Edit>) -> Response {
    response(s.guide(id, Some(e)).await)
}
