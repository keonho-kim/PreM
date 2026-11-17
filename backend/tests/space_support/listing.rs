// Purpose: Verify cross-library pagination, filtering and identity without merging client pages.
// Pattern: Real persisted assets queried through the public HTTP list contract.
// Usage: Included by backend/tests/space.rs.
// Related: adapters/sqlite/libraries/queries.rs, http/space/dto.rs.
use crate::{common, space_support};
use axum::http::StatusCode;
use prem_backend::app::Application;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn combined_list_has_global_pages_and_preserves_library_identity() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let bytes = space_support::office("pptx");
    let mut saved = Vec::new();
    for kind in ["references", "templates"] {
        let (status, item) = space_support::upload(
            &router,
            &format!("/api/v1/space/{kind}"),
            &Uuid::new_v4().to_string(),
            None,
            "shared.pptx",
            &bytes,
            &format!("Shared {kind}"),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(item["kind"], kind);
        saved.push(item);
    }
    let (_, first) = common::request(&router, "GET", "/api/v1/space/all?limit=1", None, None).await;
    let (_, second) = common::request(
        &router,
        "GET",
        "/api/v1/space/all?limit=1&offset=1",
        None,
        None,
    )
    .await;
    assert_eq!(first["total"], 2);
    assert_eq!(second["total"], 2);
    assert_eq!(first["items"].as_array().unwrap().len(), 1);
    assert_ne!(first["items"][0]["id"], second["items"][0]["id"]);
    assert_ne!(first["items"][0]["kind"], second["items"][0]["kind"]);
    for query in ["Shared", "shared.pptx", "%EA%B3%B5%EC%9A%A9"] {
        let (_, result) = common::request(
            &router,
            "GET",
            &format!("/api/v1/space/all?q={query}"),
            None,
            None,
        )
        .await;
        assert_eq!(result["total"], 2);
    }
    let template = &saved[1];
    let uri = format!(
        "/api/v1/space/templates/{}",
        template["id"].as_str().unwrap()
    );
    let (status, _) = common::request(
        &router,
        "PATCH",
        &uri,
        Some(json!({"status":"archived","expected_version":1})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, active) = common::request(&router, "GET", "/api/v1/space/all", None, None).await;
    assert_eq!(active["total"], 1);
    assert_eq!(active["items"][0]["kind"], "references");
    let (_, archived) = common::request(
        &router,
        "GET",
        "/api/v1/space/all?status=archived",
        None,
        None,
    )
    .await;
    assert_eq!(archived["total"], 1);
    assert_eq!(archived["items"][0]["kind"], "templates");
    let (status, _) = space_support::upload(
        &router,
        "/api/v1/space/all",
        &Uuid::new_v4().to_string(),
        None,
        "file.pptx",
        &bytes,
        "Invalid destination",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.shutdown().await.unwrap();
}
