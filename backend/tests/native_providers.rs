// Purpose: Verify native provider authentication, request schemas and output normalization.
// Pattern: Real application HTTP against controlled provider servers, preserving lineage.
// Usage: cargo nextest run --test native_providers; no real cloud keys or charges.
// Related: native_support/mod.rs, backend/adapters/llm/.
mod common;
mod native_support;
use axum::http::StatusCode;
use common::request;
use native_support::Fixture;
use prem_backend::app::Application;
use serde_json::{Value, json};
use uuid::Uuid;
async fn register(
    router: &axum::Router,
    fixture: &Fixture,
    kind: &str,
    suffix: &str,
    key: bool,
) -> String {
    let path = format!("/api/v1/admin/llm/providers/{}", Uuid::new_v4());
    let mut body = json!({"expected_version":0,"name":kind,"provider_type":kind,"base_url":format!("{}/{kind}/{suffix}",fixture.base),"model_identifier":"model-test","timeout_seconds":5,"enabled":true});
    if key {
        body["api_key"] = json!("synthetic-key");
    }
    let (status, result) = request(router, "PUT", &path, Some(body), None).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    path
}
#[tokio::test]
async fn native_protocols_use_their_own_contracts_and_hide_reasoning() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let f = Fixture::start().await;
    for kind in [
        "openai",
        "claude",
        "gemini",
        "lm_studio_native",
        "llama_cpp",
        "sglang",
        "vllm",
        "litellm",
    ] {
        let path = register(&router, &f, kind, "", true).await;
        let (status, models) = request(
            &router,
            "GET",
            &format!("{path}/models?expected_version=1"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{kind}: {models}");
        assert!(models.as_array().unwrap().contains(&json!("model-test")));
        assert!(!models.to_string().contains("embedding-only"));
        for mode in ["text", "structured"] {
            let before = f.seen.lock().unwrap().len();
            let (status, result) = request(
                &router,
                "POST",
                &format!("{path}/test"),
                Some(json!({"expected_version":1,"kind":mode})),
                None,
            )
            .await;
            if kind == "lm_studio_native" && mode == "structured" {
                assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
                assert_eq!(result["code"], "unsupported_capability");
                assert_eq!(before, f.seen.lock().unwrap().len());
                continue;
            }
            assert_eq!(status, StatusCode::OK, "{kind}: {result}");
            assert!(!result.to_string().contains("PRIVATE_REASONING"));
            assert_eq!(result["request"]["prompt_tokens"], 10);
            assert_eq!(result["request"]["completion_tokens"], 5);
        }
    }
    let seen = f.seen.lock().unwrap().clone();
    for r in &seen {
        assert!(!r.path.contains("synthetic-key"));
        if r.kind == "gemini" {
            assert_eq!(r.headers["x-goog-api-key"], "synthetic-key");
            assert!(r.headers.get("authorization").is_none());
        } else {
            assert_eq!(r.headers["authorization"], "Bearer synthetic-key");
        }
        if r.kind == "claude" {
            assert_eq!(r.headers["anthropic-version"], "2026-10-21");
        }
    }
    let body = |kind: &str, path: &str| -> Value {
        seen.iter()
            .rev()
            .find(|r| r.kind == kind && r.path == path)
            .unwrap()
            .body
            .clone()
    };
    let openai = body("openai", "responses");
    assert_eq!(openai["store"], false);
    assert_eq!(openai["text"]["format"]["type"], "json_schema");
    assert!(openai.get("messages").is_none());
    let claude = body("claude", "messages");
    assert!(claude["system"].is_string());
    assert!(claude.get("temperature").is_none());
    assert_eq!(claude["output_config"]["format"]["type"], "json_schema");
    let gemini = body("gemini", "models/model-test:generateContent");
    assert_eq!(
        gemini["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert!(gemini["systemInstruction"].is_object());
    let lm = body("lm_studio_native", "chat");
    assert_eq!(lm["store"], false);
    assert_eq!(lm["integrations"], json!([]));
    assert!(lm.get("messages").is_none());
    assert_eq!(
        body("llama_cpp", "completion")["prompt"],
        "server-rendered-template"
    );
    assert_eq!(body("sglang", "generate")["input_ids"], json!([17, 42]));
    assert!(body("sglang", "generate")["sampling_params"]["json_schema"].is_string());
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn missing_cloud_keys_and_partial_or_blocked_responses_fail_explicitly() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let f = Fixture::start().await;
    for kind in ["openai", "claude", "gemini"] {
        let path = register(&router, &f, kind, "", false).await;
        let before = f.seen.lock().unwrap().len();
        let (s, b) = request(
            &router,
            "POST",
            &format!("{path}/test"),
            Some(json!({"expected_version":1,"kind":"text"})),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::BAD_GATEWAY);
        assert_eq!(b["code"], "provider_authentication");
        assert_eq!(before, f.seen.lock().unwrap().len());
    }
    for kind in ["openai", "claude", "gemini", "lm_studio_native"] {
        let path = register(&router, &f, kind, "bad/", true).await;
        let (s, b) = request(
            &router,
            "POST",
            &format!("{path}/test"),
            Some(json!({"expected_version":1,"kind":"text"})),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::BAD_GATEWAY, "{kind}: {b}");
        assert_eq!(b["code"], "invalid_model_response");
    }
    app.shutdown().await.unwrap();
}
