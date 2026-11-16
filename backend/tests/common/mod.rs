// Purpose: Provide isolated storage and real-router requests for product integration tests.
// Pattern: Temporary application data under the repository's test artifact root.
// Usage: Imported only by backend integration test binaries.
// Related: projects.rs, http.rs, database_startup.rs.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt;
pub fn storage() -> tempfile::TempDir {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::Builder::new()
        .prefix("projects-")
        .tempdir_in(root)
        .unwrap()
}
pub async fn request(
    router: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    key: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(key) = key {
        request = request.header("Idempotency-Key", key);
    }
    let request = request
        .header("Content-Type", "application/json")
        .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let data = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&data).unwrap())
}

// Existing feature suites authenticate their real HTTP requests with this instance's bootstrap token.
// Access-control tests deliberately use Application::router directly instead.
#[allow(dead_code)]
pub fn router(app: &puputyx_backend::app::Application) -> Router {
    let mut value =
        axum::http::HeaderValue::from_str(&format!("Bearer {}", app.admin_token())).unwrap();
    value.set_sensitive(true);
    app.router().layer(axum::middleware::from_fn(
        move |mut request: axum::extract::Request, next: axum::middleware::Next| {
            let value = value.clone();
            async move {
                if !request.headers().contains_key("Authorization") {
                    request.headers_mut().insert("Authorization", value);
                }
                next.run(request).await
            }
        },
    ))
}
