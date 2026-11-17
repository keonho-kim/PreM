// Purpose: Verify pre-save native discovery, credentials and side-effect-free execution.
// Pattern: Real application router against captured loopback provider protocols.
// Usage: cargo nextest run --test model_discovery; never writes production data or calls cloud APIs.
// Related: native_support/mod.rs, model_registry/discovery.rs, adapters/http/model_discovery.rs.
mod common;
mod native_support;
use axum::http::StatusCode;
use common::request;
use native_support::Fixture;
use prem_backend::app::Application;
use rusqlite::Connection;
use serde_json::json;
use uuid::Uuid;
const DISCOVER: &str = "/api/v1/admin/llm/models/discover";
const PROVIDERS: &str = "/api/v1/admin/llm/providers";
#[tokio::test]
async fn every_catalog_provider_discovers_without_creating_configuration_or_history() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let f = Fixture::start().await;
    let (_, catalog) = request(
        &router,
        "GET",
        "/api/v1/admin/llm/provider-types",
        None,
        None,
    )
    .await;
    for option in catalog.as_array().unwrap() {
        let kind = option["id"].as_str().unwrap();
        let suffix = if ["lm_studio", "lm_studio_decision"].contains(&kind) {
            "v1"
        } else {
            ""
        };
        let body = json!({"provider_type":kind,"base_url":format!("{}/{kind}/{suffix}",f.base),"api_key":"synthetic-key"});
        let (status, output) = request(&router, "POST", DISCOVER, Some(body), None).await;
        assert_eq!(status, StatusCode::OK, "{kind}: {output}");
        if kind == "lm_studio_decision" {
            assert_eq!(output, json!(["decision-instance"]));
        } else {
            assert!(
                output.as_array().unwrap().contains(&json!("model-test")),
                "{kind}: {output}"
            );
        }
        assert!(!output.to_string().contains("synthetic-key"));
    }
    {
        let calls = f.seen.lock().unwrap();
        for call in calls.iter() {
            if call.kind.starts_with("gemini") {
                assert_eq!(call.headers["x-goog-api-key"], "synthetic-key");
            } else {
                assert_eq!(call.headers["authorization"], "Bearer synthetic-key");
            }
            assert!(!call.body.to_string().contains("synthetic-key"));
            if ["lm_studio", "lm_studio_decision"].contains(&call.kind.as_str()) {
                assert_eq!(call.path, "api/v1/models");
            }
            if call.kind == "vllm_sr_decision" {
                assert_eq!(call.path, "systemone/models");
            }
            if call.kind == "sglang" {
                assert_eq!(call.path, "get_model_info");
            }
            if call.kind == "claude" {
                assert_eq!(call.headers["anthropic-version"], "2026-10-21");
            }
        }
    }
    assert_eq!(
        request(&router, "GET", PROVIDERS, None, None).await.1,
        json!([])
    );
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    for table in [
        "llm_provider_config_versions",
        "llm_requests",
        "model_request_capacity",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    drop(db);
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn retained_secrets_require_matching_destination_and_version_without_changing_settings() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let f = Fixture::start().await;
    let id = Uuid::new_v4();
    let path = format!("{PROVIDERS}/{id}");
    let saved = json!({"expected_version":0,"name":"existing","provider_type":"lm_studio_native", "base_url":format!("{}/lm_studio_native/", f.base),"model_identifier":"model-test","timeout_seconds":5,"enabled":false,"api_key":"synthetic-key"});
    assert_eq!(
        request(&router, "PUT", &path, Some(saved), None).await.0,
        StatusCode::OK
    );
    let input = json!({"connection_id":id,"expected_version":1,"provider_type":"lm_studio_native"});
    assert_eq!(
        request(&router, "POST", DISCOVER, Some(input.clone()), None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        f.seen.lock().unwrap()[0].headers["authorization"],
        "Bearer synthetic-key"
    );
    let mut changed = input.clone();
    changed["expected_version"] = json!(0);
    assert_eq!(
        request(&router, "POST", DISCOVER, Some(changed), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let mut changed = input.clone();
    changed["base_url"] = json!(format!("{}/openai/", f.base));
    assert_eq!(
        request(&router, "POST", DISCOVER, Some(changed.clone()), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(f.seen.lock().unwrap().len(), 1);
    changed["provider_type"] = json!("openai");
    changed["api_key"] = json!("replacement-key");
    assert_eq!(
        request(&router, "POST", DISCOVER, Some(changed), None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        f.seen.lock().unwrap().last().unwrap().headers["authorization"],
        "Bearer replacement-key"
    );
    let (_, after) = request(&router, "GET", &path, None, None).await;
    assert_eq!(after["version"], 1);
    assert_eq!(after["enabled"], false);
    assert_eq!(after["model_identifier"], "model-test");
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn invalid_input_and_authentication_fail_without_upstream_calls() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let f = Fixture::start().await;
    for input in [
        json!({"provider_type":"openai","base_url":"file:///tmp"}),
        json!({"provider_type":"openai","base_url":"https://key@example.test"}),
        json!({"provider_type":"unknown","base_url":f.base}),
        json!({"provider_type":"openai","base_url":f.base,"api_key":"bad key"}),
        json!({"provider_type":"openai","base_url":f.base,"connection_id":Uuid::new_v4()}),
    ] {
        assert_eq!(
            request(&router, "POST", DISCOVER, Some(input), None)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let (status, error) = request(
        &router,
        "POST",
        DISCOVER,
        Some(json!({"provider_type":"openai","base_url":format!("{}/openai/",f.base)})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error["code"], "provider_authentication");
    assert!(f.seen.lock().unwrap().is_empty());
    app.shutdown().await.unwrap();
}

#[tokio::test]
async fn temporary_discovery_is_bounded_and_releases_slots_after_completion() {
    use axum::{Json, Router, routing::get};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let count = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let calls = count.clone();
    let ready = release.clone();
    let upstream = Router::new().route(
        "/models",
        get(move || {
            let count = calls.clone();
            let release = ready.clone();
            async move {
                if count.fetch_add(1, Ordering::SeqCst) < 4 {
                    release.notified().await;
                }
                Json(json!({"data":[{"id":"available"}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let input = json!({"provider_type":"openai_compatible","base_url":base});
    let mut pending = Vec::new();
    for _ in 0..4 {
        let router = router.clone();
        let input = input.clone();
        pending.push(tokio::spawn(async move {
            request(&router, "POST", DISCOVER, Some(input), None).await
        }));
    }
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while count.load(Ordering::SeqCst) != 4 {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let (status, error) = request(&router, "POST", DISCOVER, Some(input.clone()), None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(error["code"], "provider_busy");
    assert_eq!(count.load(Ordering::SeqCst), 4);
    release.notify_waiters();
    for task in pending {
        assert_eq!(task.await.unwrap().0, StatusCode::OK);
    }
    assert_eq!(
        request(&router, "POST", DISCOVER, Some(input), None)
            .await
            .0,
        StatusCode::OK
    );
    app.shutdown().await.unwrap();
    server.abort();
    let _ = server.await;
}
