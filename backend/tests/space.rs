// Purpose: Verify real uploads, byte downloads, deduplication, revisions and shared persistence.
// Pattern: Public HTTP requests against isolated on-disk SQLite and Blob storage.
// Usage: cargo nextest run --test space.
// Related: space_support/mod.rs, migrations/V4__space_libraries.sql.
#[path = "space_support/cancellation.rs"]
mod cancellation;
mod common;
#[path = "space_support/html.rs"]
mod html;
#[path = "space_support/listing.rs"]
mod listing;
mod space_support;
#[path = "space_support/validation.rs"]
mod validation;
use axum::http::StatusCode;
use puputyx_backend::app::Application;
use rusqlite::Connection;
use serde_json::json;
use space_support::{download, upload};
use uuid::Uuid;
#[tokio::test]
async fn uploads_are_shared_deduplicated_versioned_and_preserved_after_restart() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let bytes = space_support::office("pptx");
    let key = Uuid::new_v4().to_string();
    let (status, item) = upload(
        &router,
        "/api/v1/space/templates",
        &key,
        None,
        "팀 템플릿.pptx",
        &bytes,
        "회사 템플릿",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    let id = item["id"].as_str().unwrap();
    let target = format!("/api/v1/space/templates/{id}");
    let (status, original) = download(&router, &format!("{target}/download")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(original, bytes);
    let (status, replay) = upload(
        &router,
        "/api/v1/space/templates",
        &key,
        None,
        "팀 템플릿.pptx",
        &bytes,
        "회사 템플릿",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["id"], item["id"]);
    let (status, _) = upload(
        &router,
        "/api/v1/space/templates",
        &key,
        None,
        "팀 템플릿.pptx",
        &bytes,
        "다른 제목",
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, reference) = upload(
        &router,
        "/api/v1/space/references",
        &Uuid::new_v4().to_string(),
        None,
        "참고 장표.pptx",
        &bytes,
        "발표 근거",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{reference}");
    assert_ne!(reference["id"], item["id"]);
    let (_, shared) = common::request(
        &app.router(),
        "GET",
        "/api/v1/space/templates?q=%EA%B3%B5%EC%9A%A9",
        None,
        None,
    )
    .await;
    assert_eq!(shared["total"], 1);
    let (status, version) = upload(
        &router,
        &format!("{target}/versions"),
        &Uuid::new_v4().to_string(),
        Some(1),
        "새 템플릿.pptx",
        &bytes,
        "회사 템플릿",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{version}");
    assert_eq!(version["file_version"], 2);
    assert_eq!(version["version"], 2);
    assert_eq!(
        upload(
            &router,
            &format!("{target}/versions"),
            &Uuid::new_v4().to_string(),
            Some(1),
            "오래된 교체.pptx",
            &bytes,
            "회사 템플릿"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        download(&router, &format!("{target}/download?version=1"))
            .await
            .1,
        bytes
    );
    let (_, versions) =
        common::request(&router, "GET", &format!("{target}/versions"), None, None).await;
    assert_eq!(versions.as_array().unwrap().len(), 2);
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM file_blobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM file_registrations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    drop(db);
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        download(&app.router(), &format!("{target}/download?version=1"))
            .await
            .1,
        bytes
    );
    app.shutdown().await.unwrap();
    assert_eq!(
        std::fs::read_dir(root.path().join("blobs/.staging"))
            .unwrap()
            .count(),
        0
    );
}
#[tokio::test]
async fn cancellation_and_lifecycle_commands_do_not_resurrect_or_overwrite() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let key = Uuid::new_v4().to_string();
    let bytes = space_support::pdf();
    let (_, cancelled) = common::request(
        &router,
        "DELETE",
        &format!("/api/v1/space/uploads/{key}"),
        None,
        None,
    )
    .await;
    assert_eq!(cancelled["state"], "cancelled");
    assert_eq!(
        upload(
            &router,
            "/api/v1/space/references",
            &key,
            None,
            "취소.pdf",
            &bytes,
            "취소"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let key = Uuid::new_v4().to_string();
    let (_, item) = upload(
        &router,
        "/api/v1/space/references",
        &key,
        None,
        "보존.pdf",
        &bytes,
        "보존",
    )
    .await;
    let path = format!("/api/v1/space/references/{}", item["id"].as_str().unwrap());
    let (_, late) = common::request(
        &router,
        "DELETE",
        &format!("/api/v1/space/uploads/{key}"),
        None,
        None,
    )
    .await;
    assert_eq!(late["state"], "complete");
    let (a, b) = tokio::join!(
        common::request(
            &router,
            "PATCH",
            &path,
            Some(json!({"title":"변경","tags":["태그"],"expected_version":1})),
            None
        ),
        common::request(
            &router,
            "PATCH",
            &path,
            Some(json!({"status":"archived","expected_version":1})),
            None
        )
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (b.0 == StatusCode::OK && a.0 == StatusCode::CONFLICT)
    );
    assert_eq!(
        common::request(
            &router,
            "DELETE",
            &path,
            Some(json!({"expected_version":1})),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        common::request(
            &router,
            "DELETE",
            &path,
            Some(json!({"expected_version":2})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        common::request(
            &router,
            "DELETE",
            &path,
            Some(json!({"expected_version":2})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        download(&router, &format!("{path}/download")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        upload(
            &router,
            "/api/v1/space/references",
            &key,
            None,
            "보존.pdf",
            &bytes,
            "보존"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM reference_versions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
