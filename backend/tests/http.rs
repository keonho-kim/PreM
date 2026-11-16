// Purpose: Verify the process health and unknown-route contract through the real app.
// Pattern: Integration requests with isolated persisted state.
// Usage: cargo nextest run --test http.
// Related: common/mod.rs, adapters/http/mod.rs.
mod common;
use axum::http::StatusCode;
use puputyx_backend::app::Application;
#[tokio::test]
async fn health_and_unknown_routes_preserve_transport_contracts() {
    let storage = common::storage();
    let app = Application::open(storage.path()).unwrap();
    let router = app.router();
    let (status, body) = common::request(&router, "GET", "/healthz", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["service"], "PuPuTyX");
    assert_eq!(body["status"], "ok");
    let (status, body) = common::request(&router, "GET", "/api/v1/unknown", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "not_found");
    app.shutdown().await.unwrap();
}
