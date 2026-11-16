// Purpose: Expose read-only unified search with explicit scope and no model execution.
// Pattern: Typed query boundary and sanitized no-store failures.
// Usage: GET /api/v1/search from the dedicated search page.
// Related: modules/search/, adapters/sqlite/search.rs.
use crate::modules::search::{Error, Query, Search};
use axum::{
    Json, Router,
    extract::{Query as Params, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
pub(super) fn router(service: Search) -> Router {
    Router::new()
        .route("/api/v1/search", get(find))
        .with_state(service)
}
async fn find(State(service): State<Search>, Params(query): Params<Query>) -> Response {
    let (status, value) = match service.find(query).await {
        Ok(value) => (
            StatusCode::OK,
            serde_json::to_value(value).unwrap_or_default(),
        ),
        Err(error) => {
            let status = if matches!(error, Error::Invalid) {
                StatusCode::UNPROCESSABLE_ENTITY
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            };
            (
                status,
                serde_json::json!({"code":"search_failed","message":error.to_string()}),
            )
        }
    };
    (status, [(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
