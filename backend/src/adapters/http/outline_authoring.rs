// Purpose: Adapt the generation screen's explicit outline revision save.
// Pattern: Typed bounded command and no-store response; application coordinates feature owners.
// Usage: PUT project outline-for-presentation, with the outline base version and source snapshot.
// Related: app/outline_authoring.rs, frontend/features/outlines/revision-dialog.tsx.
use crate::app::outline_authoring::{Edit, OutlineAuthoring};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::put,
};
use uuid::Uuid;
pub(super) fn router(api: OutlineAuthoring) -> Router {
    Router::new()
        .route("/api/v1/projects/{p}/outline-for-presentation", put(save))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(api)
}
async fn save(
    State(api): State<OutlineAuthoring>,
    Path(p): Path<Uuid>,
    Json(input): Json<Edit>,
) -> Response {
    match api.save(p, input).await {
        Ok(value) => ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response(),
        Err(message) => (
            StatusCode::CONFLICT,
            [(header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({"code":"outline_review_conflict","message":message})),
        )
            .into_response(),
    }
}
