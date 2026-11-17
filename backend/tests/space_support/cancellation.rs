// Purpose: Verify cancellation while a request body is still streaming and restart cleanup.
// Pattern: Deterministic incomplete streams plus durable upload outcome checks.
// Usage: Included by the Space integration test binary.
// Related: ../space.rs, modules/assets/, http/space/uploads.rs.
use super::{common, space_support};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use futures_util::{StreamExt, stream};
use prem_backend::app::Application;
use rusqlite::Connection;
use std::time::Duration;
use tower::ServiceExt;
use uuid::Uuid;
#[tokio::test]
async fn cancelling_an_incomplete_body_releases_its_staging_file() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let key = Uuid::new_v4().to_string();
    let mut bytes = space_support::body("대기.pdf", &space_support::pdf(), "대기", "[]");
    bytes.truncate(bytes.len() - 30);
    let body = Body::from_stream(
        stream::once(async move { Ok::<_, std::io::Error>(bytes) }).chain(stream::pending()),
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/space/references")
        .header(
            "Content-Type",
            "multipart/form-data; boundary=space-boundary",
        )
        .header("Idempotency-Key", &key)
        .body(body)
        .unwrap();
    let upload = tokio::spawn(router.clone().oneshot(request));
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let (status, _) = common::request(
                &router,
                "GET",
                &format!("/api/v1/space/uploads/{key}"),
                None,
                None,
            )
            .await;
            if status == StatusCode::OK {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let (status, cancel) = common::request(
        &router,
        "DELETE",
        &format!("/api/v1/space/uploads/{key}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cancel["state"], "cancelled");
    let result = tokio::time::timeout(Duration::from_secs(3), upload)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(result.status(), StatusCode::CONFLICT);
    assert_eq!(
        std::fs::read_dir(root.path().join("blobs/.staging"))
            .unwrap()
            .count(),
        0
    );
    let (_, list) = common::request(&router, "GET", "/api/v1/space/references", None, None).await;
    assert_eq!(list["total"], 0);
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn restart_marks_interrupted_attempt_failed_and_removes_owned_staging() {
    let root = common::storage();
    Application::open(root.path())
        .unwrap()
        .shutdown()
        .await
        .unwrap();
    let key = Uuid::new_v4().to_string();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute("INSERT INTO upload_requests(request_key,kind,state,created_at) VALUES(?1,'reference','receiving',1)",[&key]).unwrap();
    drop(db);
    std::fs::write(
        root.path().join("blobs/.staging/.prem-upload-interrupted"),
        b"partial",
    )
    .unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, status) = common::request(
        &app.router(),
        "GET",
        &format!("/api/v1/space/uploads/{key}"),
        None,
        None,
    )
    .await;
    assert_eq!(status["state"], "failed");
    assert_eq!(
        std::fs::read_dir(root.path().join("blobs/.staging"))
            .unwrap()
            .count(),
        0
    );
    app.shutdown().await.unwrap();
}
