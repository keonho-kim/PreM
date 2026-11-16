// Purpose: Verify shared persistence, idempotent creation and concurrent rename protection.
// Pattern: Real HTTP feature contracts across independent routers and app restarts.
// Usage: cargo nextest run --test projects.
// Related: common/mod.rs, modules/projects/, adapters/sqlite/projects.rs.
mod common;
use axum::http::StatusCode;
use puputyx_backend::app::Application;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn projects_are_shared_retry_safe_and_persistent() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let first = app.router();
    let second = app.router();
    let key = Uuid::new_v4().to_string();
    let (status, created) = common::request(
        &first,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"  사내 프로젝트  ", "end_date":"2030-01-31"})),
        Some(&key),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["name"], "사내 프로젝트");
    let (_, shared) = common::request(&second, "GET", "/api/v1/projects", None, None).await;
    assert_eq!(shared["total"], 1);
    assert_eq!(shared["items"][0], created);
    let (status, replay) = common::request(
        &second,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"사내 프로젝트", "end_date":"2030-01-31"})),
        Some(&key),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay, created);
    let (status, _) = common::request(
        &second,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"다른 입력", "end_date":"2030-01-31"})),
        Some(&key),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.shutdown().await.unwrap();
    let reopened = Application::open(root.path()).unwrap();
    let (_, saved) =
        common::request(&reopened.router(), "GET", "/api/v1/projects", None, None).await;
    assert_eq!(saved["items"][0], created);
    let (_, replay) = common::request(
        &reopened.router(),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"사내 프로젝트", "end_date":"2030-01-31"})),
        Some(&key),
    )
    .await;
    assert_eq!(replay["id"], created["id"]);
    reopened.shutdown().await.unwrap();
}
#[tokio::test]
async fn concurrent_renames_cannot_overwrite_each_other() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let (_, created) = common::request(
        &router,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"원래 이름", "end_date":"2030-01-31"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    let path = format!("/api/v1/projects/{}", created["id"].as_str().unwrap());
    let (a, b) = tokio::join!(
        common::request(
            &router,
            "PATCH",
            &path,
            Some(json!({"name":"첫 번째", "expected_version":1})),
            None
        ),
        common::request(
            &router,
            "PATCH",
            &path,
            Some(json!({"name":"두 번째", "expected_version":1})),
            None
        )
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (b.0 == StatusCode::OK && a.0 == StatusCode::CONFLICT)
    );
    let (_, latest) = common::request(&router, "GET", &path, None, None).await;
    assert_eq!(latest["version"], 2);
    let winner = if a.0 == StatusCode::OK { a.1 } else { b.1 };
    assert_eq!(latest, winner);
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn validation_pagination_and_literal_search_are_enforced() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    for name in ["", "  ", "bad\nname", &"가".repeat(81)] {
        let (status, _) = common::request(
            &router,
            "POST",
            "/api/v1/projects",
            Some(json!({"name":name, "end_date":"2030-01-31"})),
            Some(&Uuid::new_v4().to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"valid", "end_date":"2030-01-31"})),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    for name in ["한글 기획", "한글 운영", "100% 확인"] {
        assert_eq!(
            common::request(
                &router,
                "POST",
                "/api/v1/projects",
                Some(json!({"name":name, "end_date":"2030-01-31"})),
                Some(&Uuid::new_v4().to_string())
            )
            .await
            .0,
            StatusCode::CREATED
        );
    }
    let (_, page) = common::request(
        &router,
        "GET",
        "/api/v1/projects?q=%ED%95%9C%EA%B8%80&limit=1&offset=1",
        None,
        None,
    )
    .await;
    assert_eq!(page["total"], 2);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    let (_, percent) = common::request(&router, "GET", "/api/v1/projects?q=%25", None, None).await;
    assert_eq!(percent["total"], 1);
    assert_eq!(
        common::request(&router, "GET", "/api/v1/projects?limit=0", None, None)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        common::request(&router, "GET", "/api/v1/projects/invalid", None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    app.shutdown().await.unwrap();
}
