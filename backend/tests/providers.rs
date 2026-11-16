// Purpose: Verify provider persistence, encryption, concurrency and real HTTP diagnostics.
// Pattern: Isolated application stores and a deterministic compatible model server.
// Usage: cargo nextest run --test providers; real LM Studio is a separate acceptance check.
// Related: provider_support/mod.rs, adapters/http/providers.rs, V5 migration.
mod common;
mod provider_support;
use axum::http::StatusCode;
use common::request;
use provider_support::{Fixture, settings};
use puputyx_backend::app::Application;
use rusqlite::Connection;
use serde_json::json;
use uuid::Uuid;
const ROOT: &str = "/api/v1/admin/llm/providers";
#[tokio::test]
async fn encrypted_versions_are_shared_preserved_and_require_the_original_key() {
    let fixture = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    assert_eq!(request(&router, "GET", ROOT, None, None).await.1, json!([]));
    let id = Uuid::new_v4();
    let path = format!("{ROOT}/{id}");
    let mut input = settings(&fixture.base, "auth");
    input["api_key"] = json!("fixture-key");
    let (status, first) = request(&router, "PUT", &path, Some(input.clone()), None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["has_secret"], true);
    assert!(!first.to_string().contains("fixture-key"));
    let test_path = format!("{path}/test");
    let (_, output) = request(
        &router,
        "POST",
        &test_path,
        Some(json!({"expected_version":1,"kind":"text"})),
        None,
    )
    .await;
    assert_eq!(output["text"], "PuPuTyX connection OK");
    assert!(!output.to_string().contains("reasoning_content"));
    assert_eq!(
        request(&router, "PUT", &path, Some(input.clone()), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    input["expected_version"] = json!(1);
    input["name"] = json!("Updated server");
    input.as_object_mut().unwrap().remove("api_key");
    let (_, second) = request(&router, "PUT", &path, Some(input.clone()), None).await;
    assert_eq!(second["version"], 2);
    assert_ne!(second["config_id"], first["config_id"]);
    assert_eq!(
        request(
            &router,
            "POST",
            &test_path,
            Some(json!({"expected_version":1,"kind":"text"})),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let changed = input.clone();
    // Build an endpoint change without accepting the old credential destination.
    let mut changed = changed;
    changed["expected_version"] = json!(2);
    changed["base_url"] = json!(format!("{}/ok/v1", fixture.base));
    assert_eq!(
        request(&router, "PUT", &path, Some(changed), None).await.0,
        StatusCode::BAD_REQUEST
    );
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let secrets = db
        .prepare("SELECT encrypted_secret FROM llm_provider_config_versions")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(secrets.len(), 2);
    assert_ne!(secrets[0], secrets[1]);
    assert!(secrets.iter().all(|s| !s.contains("fixture-key")));
    assert_eq!(
        db.query_row("SELECT count(*) FROM llm_requests", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(db);
    let reopened = Application::open(root.path()).unwrap();
    assert_eq!(
        request(&crate::common::router(&reopened), "GET", ROOT, None, None)
            .await
            .1[0]["version"],
        2
    );
    assert_eq!(
        request(
            &crate::common::router(&reopened),
            "POST",
            &test_path,
            Some(json!({"expected_version":2,"kind":"structured"})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    reopened.shutdown().await.unwrap();
    let key = root.path().join("config/secret.key");
    let bytes = std::fs::read(&key).unwrap();
    std::fs::remove_file(&key).unwrap();
    assert!(Application::open(root.path()).is_err());
    assert!(!key.exists());
    std::fs::write(&key, &bytes).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let restored = Application::open(root.path()).unwrap();
    restored.shutdown().await.unwrap();
    std::fs::write(&key, [0_u8; 32]).unwrap();
    assert!(Application::open(root.path()).is_err());
}
#[tokio::test]
async fn diagnostics_validate_payloads_and_bound_errors_without_leaking_upstream_content() {
    let fixture = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    for (mode, kind, status, code) in [
        ("ok", "structured", 200, ""),
        ("auth", "text", 502, "provider_authentication"),
        ("invalid", "structured", 502, "invalid_model_response"),
        ("oversize", "text", 502, "invalid_model_response"),
        ("timeout", "text", 504, "provider_timeout"),
    ] {
        let id = Uuid::new_v4();
        let path = format!("{ROOT}/{id}");
        assert_eq!(
            request(
                &router,
                "PUT",
                &path,
                Some(settings(&fixture.base, mode)),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        let (actual, result) = request(
            &router,
            "POST",
            &format!("{path}/test"),
            Some(json!({"expected_version":1,"kind":kind})),
            None,
        )
        .await;
        assert_eq!(actual.as_u16(), status, "{result}");
        if status != 200 {
            assert_eq!(result["code"], code);
        }
        assert!(!result.to_string().contains("upstream error body"));
        let (_, history) = request(&router, "GET", &format!("{path}/requests"), None, None).await;
        assert_eq!(history.as_array().unwrap().len(), 1);
    }
    let path = format!("{ROOT}/{}", Uuid::new_v4());
    let mut bad = settings(&fixture.base, "ok");
    bad["base_url"] = json!("file:///tmp/test");
    assert_eq!(
        request(&router, "PUT", &path, Some(bad), None).await.0,
        StatusCode::BAD_REQUEST
    );
    let path = format!("{ROOT}/{}", Uuid::new_v4());
    request(
        &router,
        "PUT",
        &path,
        Some(settings(&fixture.base, "redirect")),
        None,
    )
    .await;
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("{path}/models?expected_version=1"),
            None,
            None
        )
        .await
        .0,
        StatusCode::BAD_GATEWAY
    );
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn in_flight_inference_keeps_its_config_while_settings_are_updated() {
    let fixture = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let path = format!("{ROOT}/{}", Uuid::new_v4());
    let input = settings(&fixture.base, "wait");
    let (_, first) = request(&router, "PUT", &path, Some(input.clone()), None).await;
    let pending = tokio::spawn({
        let router = router.clone();
        let path = path.clone();
        async move {
            request(
                &router,
                "POST",
                &format!("{path}/test"),
                Some(json!({"expected_version":1,"kind":"text"})),
                None,
            )
            .await
        }
    });
    fixture.started().await;
    let mut second = input;
    second["expected_version"] = json!(1);
    second["enabled"] = json!(false);
    assert_eq!(
        request(&router, "PUT", &path, Some(second), None).await.0,
        StatusCode::OK
    );
    fixture.resume();
    let (status, result) = pending.await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["request"]["config_id"], first["config_id"]);
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("{path}/test"),
            Some(json!({"expected_version":2,"kind":"text"})),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    app.shutdown().await.unwrap();
}
