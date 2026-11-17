// Purpose: Fence late search results and preserve pinned model versions through restart.
// Pattern: Controlled native requests, explicit cancellation and immutable candidate checkpoints.
// Usage: cargo nextest run --test related_recovery.
// Related: relation_support/, modules/relations/worker.rs.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod relation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use prem_backend::app::Application;
use relation_support::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn entered(f: &Fixture, n: usize) {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while f.model.calls.load(Ordering::SeqCst) < n {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn restart_keeps_the_initial_model_and_reuses_finished_results() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let provider = register(&app, &f).await;
    let target = setup(&app, 12).await;

    f.model.hold.store(true, Ordering::SeqCst);
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    entered(&f, 1).await;
    let(s,v)=request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{provider}"),Some(json!({"expected_version":1,"name":"새 모델","provider_type":"lm_studio_decision","model_identifier":"fixture-two","base_url":f.base,"timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200, "{v}");
    app.shutdown().await.unwrap();
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    wait(&app, &target, id, "succeeded").await;
    assert!(
        f.model
            .model_ids
            .lock()
            .unwrap()
            .iter()
            .all(|id| id == "fixture")
    );
    let count = f.model.calls.load(Ordering::SeqCst);
    let next = start(&app, &target, "efficiency").await;
    wait(&app, &target, next["id"].as_str().unwrap(), "succeeded").await;
    assert!(f.model.calls.load(Ordering::SeqCst) > count);
    assert!(
        f.model
            .model_ids
            .lock()
            .unwrap()
            .iter()
            .any(|id| id == "fixture-two")
    );
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_fences_late_answers_and_retry_is_explicit() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    register(&app, &f).await;
    let target = setup(&app, 8).await;

    f.model.hold.store(true, Ordering::SeqCst);
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    entered(&f, 1).await;
    let (_, active) = request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/projects/{target}/related-searches/{id}"),
        None,
        None,
    )
    .await;
    let (s, v) = request(
        &crate::common::router(&app),
        "POST",
        &format!("/api/v1/projects/{target}/related-searches/{id}/cancel"),
        Some(json!({"expected_version":active["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let cancelled = wait(&app, &target, id, "cancelled").await;
    assert_eq!(cancelled["completed"], 0);
    let (s, r) = request(
        &crate::common::router(&app),
        "POST",
        &format!("/api/v1/projects/{target}/related-searches/{id}/retry"),
        Some(json!({"expected_version":cancelled["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{r}");
    wait(&app, &target, id, "succeeded").await;
    app.shutdown().await.unwrap();
}
