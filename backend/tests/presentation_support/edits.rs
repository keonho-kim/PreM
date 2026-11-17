// Purpose: Share HTTP, proposal and native PPTX readers across presentation edit integration tests.
// Pattern: Actual routers and bounded waits with no production storage or credentials.
// Usage: presentation_objects.rs and presentation_batches.rs.
// Related: common/, outline_support/, presentation_support/mod.rs.
use crate::common::request;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::{io::Read, time::Duration};
use tower::ServiceExt;
use uuid::Uuid;
pub async fn upload(app: &Application, p: &str, key: &str, bytes: Vec<u8>) -> (u16, Value) {
    let response = app
        .router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/v1/projects/{p}/presentation-media?name=diagram.png"
                ))
                .header("Idempotency-Key", key)
                .header("Content-Type", "image/png")
                .body(Body::from(bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
pub async fn slides(app: &Application, p: &str, run: &Value) -> Value {
    request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/slides",
            run["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await
    .1
}
pub fn thread(p: &str, r: &Value, s: &Value) -> String {
    format!(
        "/api/v1/projects/{p}/presentations/{}/slides/{}/edits",
        r["id"].as_str().unwrap(),
        s[0]["id"].as_str().unwrap()
    )
}
pub async fn proposal(app: &Application, path: &str, status: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(40), async {
        loop {
            let (_, rows) = request(&app.router(), "GET", path, None, None).await;
            if let Some(e) = rows.as_array().unwrap().last() {
                if e["status"] == status {
                    return e.clone();
                }
                assert!(e["status"] != "failed" || status == "failed", "{e}");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap()
}
pub async fn command(app: &Application, p: &str, e: &Value, action: &str) -> Value {
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/slide-edits/{}/{action}",
            e["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":e["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
pub async fn output(
    app: &Application,
    p: &str,
    r: &Value,
) -> zip::ZipArchive<std::io::Cursor<Vec<u8>>> {
    let res = app
        .router()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/projects/{p}/presentations/{}/download",
                    r["id"].as_str().unwrap()
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let bytes = to_bytes(res.into_body(), 50 * 1024 * 1024).await.unwrap();
    zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap()
}
pub fn xml(zip: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, name: &str) -> String {
    let mut s = String::new();
    zip.by_name(name).unwrap().read_to_string(&mut s).unwrap();
    s
}
