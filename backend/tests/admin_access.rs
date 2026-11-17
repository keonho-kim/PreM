// Purpose: Verify Admin authorization, restart rotation and public authoring separation.
// Pattern: Real router with explicit valid/invalid credentials; no test authentication bypass.
// Usage: cargo nextest run --test admin_access; all storage is disposable.
// Related: adapters/http/admin_access.rs, authoring_models.rs, common/.
mod common;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use prem_backend::app::Application;
use serde_json::json;
use tower::ServiceExt;
async fn access(app: &Application, path: &str, token: Option<&str>) -> u16 {
    let mut request = Request::builder()
        .method(if path.ends_with("/access") {
            "POST"
        } else {
            "GET"
        })
        .uri(path);
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let response = app
        .router()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains(app.admin_token()));
    status
}
#[tokio::test]
async fn all_admin_routes_require_current_token_and_public_models_are_redacted() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(app.admin_token().len(), 64);
    for path in [
        "/api/v1/admin/access",
        "/api/v1/admin/llm/providers",
        "/api/v1/admin/llm/provider-types",
        "/api/v1/admin/document-processing/settings",
        "/api/v1/admin/related-search/settings",
        "/api/v1/admin/missing",
    ] {
        assert_eq!(access(&app, path, None).await, 401);
    }
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some("incorrect")).await,
        401
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(app.admin_token())).await,
        200
    );
    let id = uuid::Uuid::new_v4();
    let(s,v)=common::request(&common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{id}"),Some(json!({"expected_version":0,"name":"작성 AI","provider_type":"openai_compatible","base_url":"http://127.0.0.1:1234/v1","model_identifier":"writing-model","timeout_seconds":30,"enabled":true,"api_key":"synthetic-private-key"})),None).await;
    assert_eq!(s, 200, "{v}");
    let (s, models) =
        common::request(&app.router(), "GET", "/api/v1/models/authoring", None, None).await;
    assert_eq!(s, 200);
    let object = models[0].as_object().unwrap();
    assert_eq!(object.len(), 4);
    assert!(
        object.contains_key("id")
            && object.contains_key("name")
            && object.contains_key("version")
            && object.contains_key("model_identifier")
    );
    for path in ["/healthz", "/api/v1/projects"] {
        assert_eq!(access(&app, path, None).await, 200);
    }
    let previous = app.admin_token().to_owned();
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert!(previous != app.admin_token());
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(&previous)).await,
        401
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(app.admin_token())).await,
        200
    );
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn invalid_attempts_are_bounded_without_locking_out_valid_admin() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    for _ in 0..30 {
        assert_eq!(
            access(&app, "/api/v1/admin/access", Some("incorrect")).await,
            401
        );
    }
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some("incorrect")).await,
        429
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(app.admin_token())).await,
        200
    );
    assert_ne!(
        access(&app, "/api/v1/%61dmin/llm/providers", None).await,
        200
    );
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn general_token_change_is_temporary_versioned_and_does_not_gate_public_services() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let initial = app.admin_token().to_owned();
    let replacement = "synthetic-Changed-Admin-token-123";
    let change = |token: &str, version: u64, new: &str| {
        Request::builder()
            .method("PUT")
            .uri("/api/v1/admin/general")
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .body(Body::from(
                json!({"expected_version":version,"token":new}).to_string(),
            ))
            .unwrap()
    };
    let denied = app
        .router()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/admin/general")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), 401);
    let same = app
        .router()
        .oneshot(change(&initial, 1, &initial))
        .await
        .unwrap();
    assert_eq!(same.status(), 422);
    let invalid = app
        .router()
        .oneshot(change(&initial, 1, "short"))
        .await
        .unwrap();
    assert_eq!(invalid.status(), 422);
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(&initial)).await,
        200
    );
    let response = app
        .router()
        .oneshot(change(&initial, 1, replacement))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"version":2})
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(&initial)).await,
        401
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(replacement)).await,
        200
    );
    let conflict = app
        .router()
        .oneshot(change(replacement, 1, "another-synthetic-token"))
        .await
        .unwrap();
    assert_eq!(conflict.status(), 409);
    for path in [
        "/api/v1/projects",
        "/api/v1/space/references",
        "/api/v1/space/templates",
        "/api/v1/models/authoring",
    ] {
        assert_eq!(access(&app, path, None).await, 200);
    }
    let (s, p) = common::request(
        &app.router(),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"공유 프로젝트","due_date":"2030-01-01"})),
        Some(&uuid::Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 201, "{p}");
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(replacement)).await,
        401
    );
    assert_eq!(
        access(&app, "/api/v1/admin/access", Some(app.admin_token())).await,
        200
    );
    let (_, general) = common::request(
        &common::router(&app),
        "GET",
        "/api/v1/admin/general",
        None,
        None,
    )
    .await;
    assert_eq!(general, json!({"version":1}));
    let (_, projects) = common::request(&app.router(), "GET", "/api/v1/projects", None, None).await;
    assert_eq!(projects["items"][0]["id"], p["id"]);
    app.shutdown().await.unwrap();
}
