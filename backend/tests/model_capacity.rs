// Purpose: Verify persisted live request limits through the actual HTTP and provider execution stack.
// Pattern: Isolated SQLite, held local model calls and both LLM/System One connection types.
// Usage: cargo test --test model_capacity; no production data or model settings are used.
// Related: capacity_support/, modules/model_execution/, V10__model_capacity.sql.
mod capacity_support;
mod common;
use axum::{Router, http::StatusCode};
use capacity_support::*;
use common::request;
use prem_backend::app::Application;
use serde_json::{Value, json};
use uuid::Uuid;
fn path(id: Uuid) -> String {
    format!("/api/v1/admin/llm/providers/{id}/capacity")
}
async fn limits(
    app: &Application,
    id: Uuid,
    version: i64,
    parallel: u32,
    queue: u32,
) -> (StatusCode, Value) {
    request(&crate::common::router(app),"PUT",&path(id),Some(json!({"expected_version":version,"max_parallel":parallel,"queue_capacity":queue,"queue_timeout_seconds":1})),None).await
}
async fn register(app: &Application, f: &Fixture, kind: &str) -> Uuid {
    let id = Uuid::new_v4();
    let (status, _) = request(
        &crate::common::router(app),
        "PUT",
        &format!("/api/v1/admin/llm/providers/{id}"),
        Some(settings(&f.base, kind, 0, "before")),
        None,
    )
    .await;
    assert_eq!(status, 200);
    id
}
fn invoke(router: Router, id: Uuid, system: bool) -> tokio::task::JoinHandle<(StatusCode, Value)> {
    tokio::spawn(async move {
        let (route, input) = if system {
            (
                format!("/api/v1/admin/decisions/{id}/evaluate"),
                json!({"expected_version":1,"batch":{"state":"Contents 1. Introduction 3","questions":{"toc":{"type":"choice","instructions":"Is this a table of contents?","criteria":{"0":"No","1":"Yes"}}}}}),
            )
        } else {
            (
                format!("/api/v1/admin/llm/providers/{id}/test"),
                json!({"expected_version":1,"kind":"text"}),
            )
        };
        request(&router, "POST", &route, Some(input), None).await
    })
}
async fn queued(app: &Application, id: Uuid, count: u64) {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let (_, s) = request(&crate::common::router(app), "GET", &path(id), None, None).await;
            if s["queued"] == count {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("queue reached expected size");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn settings_validate_conflicts_and_survive_restart_without_changing_model_config() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let f = Fixture::start().await;
    let id = register(&app, &f, "openai_compatible").await;
    let (status, initial) =
        request(&crate::common::router(&app), "GET", &path(id), None, None).await;
    assert_eq!(status, 200);
    assert_eq!(initial["max_parallel"], 4);
    assert_eq!(initial["queue_capacity"], 32);
    assert_eq!(limits(&app, id, 0, 0, 1).await.0, 400);
    assert_eq!(limits(&app, id, 0, 1025, 1).await.0, 400);
    assert_eq!(limits(&app, id, 0, 1, 4097).await.0, 400);
    assert_eq!(limits(&app, Uuid::new_v4(), 0, 1, 1).await.0, 404);
    let (status, saved) = limits(&app, id, 0, 256, 1024).await;
    assert_eq!(status, 200);
    assert_eq!(saved["version"], 1);
    assert_eq!(limits(&app, id, 0, 1, 0).await.0, 409);
    let (_, provider) = request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/admin/llm/providers/{id}"),
        None,
        None,
    )
    .await;
    assert_eq!(provider["version"], 1);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, restored) = request(&crate::common::router(&app), "GET", &path(id), None, None).await;
    assert_eq!(restored, saved);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_settings_apply_to_llm_and_system_and_queued_calls_keep_model_revision() {
    for kind in ["openai_compatible", "lm_studio_decision"] {
        let root = common::storage();
        let app = Application::open(root.path()).unwrap();
        let f = Fixture::start().await;
        let id = register(&app, &f, kind).await;
        assert_eq!(limits(&app, id, 0, 1, 2).await.0, 200);
        let system = kind == "lm_studio_decision";
        let first = invoke(crate::common::router(&app), id, system);
        f.started(1).await;
        let second = invoke(crate::common::router(&app), id, system);
        queued(&app, id, 1).await;
        let third = invoke(crate::common::router(&app), id, system);
        queued(&app, id, 2).await;
        assert_eq!(
            invoke(crate::common::router(&app), id, system)
                .await
                .unwrap()
                .0,
            429
        );
        let (status, _) = request(
            &crate::common::router(&app),
            "PUT",
            &format!("/api/v1/admin/llm/providers/{id}"),
            Some(settings(&f.base, kind, 1, "after")),
            None,
        )
        .await;
        assert_eq!(status, 200);
        let (_, expanded) = limits(&app, id, 1, 2, 0).await;
        assert_eq!(expanded["active"], 2);
        assert_eq!(expanded["queued"], 1);
        f.started(2).await;
        f.model.release.add_permits(3);
        for task in [first, second, third] {
            let (status, body) = task.await.unwrap();
            assert_eq!(status, 200, "{body}");
        }
        assert_eq!(
            *f.model.models.lock().unwrap(),
            vec!["before", "before", "before"]
        );
        let (_, idle) = request(&crate::common::router(&app), "GET", &path(id), None, None).await;
        assert_eq!(idle["active"], 0);
        assert_eq!(idle["queued"], 0);
        app.shutdown().await.unwrap();
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn abandoned_and_timed_out_waiters_never_reach_the_provider() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let f = Fixture::start().await;
    let id = register(&app, &f, "openai_compatible").await;
    limits(&app, id, 0, 1, 1).await;
    let first = invoke(crate::common::router(&app), id, false);
    f.started(1).await;
    let aborted = invoke(crate::common::router(&app), id, false);
    queued(&app, id, 1).await;
    aborted.abort();
    let _ = aborted.await;
    queued(&app, id, 0).await;
    let (status, body) = invoke(crate::common::router(&app), id, false)
        .await
        .unwrap();
    assert_eq!(status, 504);
    assert_eq!(body["code"], "provider_queue_timeout");
    assert_eq!(f.model.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    queued(&app, id, 0).await;
    f.model.release.add_permits(1);
    assert_eq!(first.await.unwrap().0, 200);
    app.shutdown().await.unwrap();
}
