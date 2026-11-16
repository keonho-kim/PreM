// Purpose: Verify native decision protocols, generation bridge, durable lineage and failure isolation.
// Pattern: Real application, SQLite and local HTTP fixture; no production data or cloud calls.
// Usage: cargo nextest run --test decisions.
// Related: decision_support/mod.rs, modules/decisions/, V7 migration.
mod common;
mod decision_support;
use common::request;
use decision_support::Fixture;
use puputyx_backend::app::Application;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
fn batch() -> Value {
    json!({"expected_version":1,"batch":{"state":{"r1":"Contents","r2":"Paragraph"},"questions":{"toc1":{"type":"choice","instructions":"Is state.r1 a table of contents?","criteria":{"0":"No","1":"Yes"}},"toc2":{"type":"choice","instructions":"Is state.r2 a table of contents?","criteria":{"0":"No","1":"Yes"}}}}})
}
fn settings(base: &str, mode: &str, kind: &str) -> Value {
    json!({"expected_version":0,"name":kind,"provider_type":kind,"base_url":format!("{base}/{mode}/v1"),"model_identifier":"fixture","timeout_seconds":5,"enabled":true,"api_key":"fixture-key"})
}
async fn register(app: &Application, f: &Fixture, mode: &str, kind: &str) -> (Uuid, Value) {
    let id = Uuid::new_v4();
    let (s, p) = request(
        &crate::common::router(app),
        "PUT",
        &format!("/api/v1/admin/llm/providers/{id}"),
        Some(settings(&f.base, mode, kind)),
        None,
    )
    .await;
    assert_eq!(s, 200, "{p}");
    (id, p)
}
#[tokio::test]
async fn every_native_protocol_and_llm_bridge_batch_once_and_preserve_history() {
    let f = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let mut stored = Vec::new();
    for (kind, mode) in [
        ("typesafe", "typesafe"),
        ("lm_studio_decision", "system"),
        ("llama_decision", "system"),
        ("sglang_decision", "system"),
        ("vllm_decision", "system"),
        ("vllm_sr_decision", "vllm_sr"),
        ("litellm_decision", "system"),
        ("openai_decision", "openai"),
        ("gemini_decision", "gemini"),
        ("lm_studio", "llm"),
    ] {
        let (id, p) = register(&app, &f, mode, kind).await;
        let calls = f.calls.load(Ordering::SeqCst);
        let (s, r) = request(
            &crate::common::router(&app),
            "POST",
            &format!("/api/v1/admin/decisions/{id}/evaluate"),
            Some(batch()),
            None,
        )
        .await;
        assert_eq!(s, 200, "{kind}: {r}");
        assert_eq!(f.calls.load(Ordering::SeqCst), calls + 1);
        assert_eq!(r["result"]["answers"]["toc1"]["choice"], "1");
        assert_eq!(r["result"]["answers"]["toc2"]["choice"], "0");
        assert_eq!(
            r["result"]["statistics"],
            if mode == "llm" {
                "unavailable"
            } else {
                "provider_reported"
            }
        );
        assert_eq!(r["request"]["kind"], "decision");
        assert_eq!(r["request"]["config_id"], p["config_id"]);
        assert_eq!(r["request"]["prompt_tokens"], 20);
        if mode == "llm" {
            assert!(r["result"]["answers"]["toc1"]["probabilities"].is_null());
        } else {
            let (s, models) = request(
                &crate::common::router(&app),
                "GET",
                &format!("/api/v1/admin/llm/providers/{id}/models?expected_version=1"),
                None,
                None,
            )
            .await;
            assert_eq!(s, 200);
            assert_eq!(models, json!(["fixture"]));
            let (s, _) = request(
                &crate::common::router(&app),
                "POST",
                &format!("/api/v1/admin/llm/providers/{id}/test"),
                Some(json!({"expected_version":1,"kind":"text"})),
                None,
            )
            .await;
            assert_eq!(s, 422);
            assert_eq!(f.calls.load(Ordering::SeqCst), calls + 1);
        }
        stored.push(id);
    }
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    for id in stored {
        let (s, h) = request(
            &crate::common::router(&app),
            "GET",
            &format!("/api/v1/admin/llm/providers/{id}/requests"),
            None,
            None,
        )
        .await;
        assert_eq!(s, 200);
        assert!(
            h.as_array()
                .unwrap()
                .iter()
                .any(|r| r["kind"] == "decision" && r["status"] == "succeeded")
        );
        assert!(!h.to_string().contains("Contents"));
        assert!(!h.to_string().contains("fixture-key"));
    }
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn invalid_answers_are_failed_without_fallback_or_partial_success() {
    let f = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    for mode in [
        "missing",
        "extra",
        "sum",
        "invalid",
        "refusal",
        "duplicate",
        "error",
    ] {
        let (id, _) = register(&app, &f, mode, "lm_studio_decision").await;
        let calls = f.calls.load(Ordering::SeqCst);
        let (s, r) = request(
            &crate::common::router(&app),
            "POST",
            &format!("/api/v1/admin/decisions/{id}/evaluate"),
            Some(batch()),
            None,
        )
        .await;
        assert_eq!(s, 502, "{r}");
        assert_eq!(f.calls.load(Ordering::SeqCst), calls + 1);
        assert!(!r.to_string().contains("private body"));
        let (_, h) = request(
            &crate::common::router(&app),
            "GET",
            &format!("/api/v1/admin/llm/providers/{id}/requests"),
            None,
            None,
        )
        .await;
        assert_eq!(h[0]["status"], "failed");
    }
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn unsupported_input_and_stale_configuration_never_reach_the_provider() {
    let f = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let (id, _) = register(&app, &f, "system", "lm_studio_decision").await;
    for invalid in [
        json!({}),
        json!({"bad":{"type":"noul","instructions":"yes?"}}),
        json!({"bad":{"type":"choice","instructions":"?","criteria":{"0":"No"}}}),
    ] {
        let mut b = batch();
        b["batch"]["questions"] = invalid;
        assert_eq!(
            request(
                &crate::common::router(&app),
                "POST",
                &format!("/api/v1/admin/decisions/{id}/evaluate"),
                Some(b),
                None
            )
            .await
            .0,
            400
        );
    }
    let mut stale = batch();
    stale["expected_version"] = json!(2);
    assert_eq!(
        request(
            &crate::common::router(&app),
            "POST",
            &format!("/api/v1/admin/decisions/{id}/evaluate"),
            Some(stale),
            None
        )
        .await
        .0,
        409
    );
    let (id, _) = register(&app, &f, "system", "lm_studio_native").await;
    assert_eq!(
        request(
            &crate::common::router(&app),
            "POST",
            &format!("/api/v1/admin/decisions/{id}/evaluate"),
            Some(batch()),
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn pending_decision_keeps_version_while_connection_changes() {
    let f = Fixture::start().await;
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let (id, p) = register(&app, &f, "slow", "lm_studio_decision").await;
    let router = crate::common::router(&app);
    let pending = tokio::spawn(async move {
        request(
            &router,
            "POST",
            &format!("/api/v1/admin/decisions/{id}/evaluate"),
            Some(batch()),
            None,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while f.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
    let mut update = settings(&f.base, "slow", "lm_studio_decision");
    update["expected_version"] = json!(1);
    update["enabled"] = json!(false);
    assert_eq!(
        request(
            &crate::common::router(&app),
            "PUT",
            &format!("/api/v1/admin/llm/providers/{id}"),
            Some(update),
            None
        )
        .await
        .0,
        200
    );
    let (s, r) = pending.await.unwrap();
    assert_eq!(s, 200);
    assert_eq!(r["request"]["config_id"], p["config_id"]);
    app.shutdown().await.unwrap();
}
