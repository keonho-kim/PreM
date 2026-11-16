// Purpose: Verify checkpoint reuse, cancellation, restart recovery and stale-result fencing.
// Pattern: Real app and held/failing synthetic LLM; immutable revisions remain authoritative.
// Usage: cargo nextest run --test outline_recovery.
// Related: outline_support/, modules/outlines/worker.rs, model_execution/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use puputyx_backend::app::Application;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn control(
    app: &Application,
    p: &str,
    s: &serde_json::Value,
    action: &str,
) -> axum::http::StatusCode {
    request(
        &crate::common::router(app),
        "POST",
        &format!(
            "/api/v1/projects/{p}/outline/runs/{}/{action}",
            s["run"]["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":s["run"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await
    .0
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_mapping_retries_only_missing_batches_and_keeps_the_previous_revision() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    create(&app, &p, &c, "generate").await;
    wait(&app, &p, "succeeded").await;
    f.model.fail_second.store(true, Ordering::SeqCst);
    create(&app, &p, &c, "map").await;
    let failed = wait(&app, &p, "failed").await;
    assert_eq!(failed["version"], 1);
    assert_eq!(failed["run"]["completed"], 1);
    assert_eq!(f.model.maps.load(Ordering::SeqCst), 2);
    f.model.fail_second.store(false, Ordering::SeqCst);
    assert_eq!(control(&app, &p, &failed, "retry").await, 200);
    let result = wait(&app, &p, "succeeded").await;
    assert_eq!(result["version"], 2);
    assert_eq!(f.model.maps.load(Ordering::SeqCst), 4);
    assert_eq!(result["run"]["completed"], 3);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_and_concurrent_manual_edit_cannot_be_overwritten_by_late_output() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    create(&app, &p, &c, "generate").await;
    let base = wait(&app, &p, "succeeded").await;
    f.model.hold.store(true, Ordering::SeqCst);
    create(&app, &p, &c, "map").await;
    wait(&app, &p, "running").await;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while f.model.calls.load(Ordering::SeqCst) < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let running = state(&app, &p).await;
    assert_eq!(control(&app, &p, &running, "cancel").await, 200);
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let cancelled = state(&app, &p).await;
    assert_eq!(cancelled["run"]["status"], "cancelled");
    assert_eq!(cancelled["version"], 1);
    f.model.hold.store(true, Ordering::SeqCst);
    create(&app, &p, &c, "map").await;
    wait(&app, &p, "running").await;
    let mut draft = base["draft"].clone();
    draft["nodes"][0]["title"] = json!("사용자가 확정한 제목");
    let (status, _) = request(
        &crate::common::router(&app),
        "PUT",
        &format!("/api/v1/projects/{p}/outline"),
        Some(edit(&base, draft)),
        None,
    )
    .await;
    assert_eq!(status, 200);
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    let result = wait(&app, &p, "failed").await;
    assert_eq!(result["version"], 2);
    assert_eq!(result["draft"]["nodes"][0]["title"], "사용자가 확정한 제목");
    assert_eq!(result["run"]["error_code"], "inputs_changed");
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_keeps_the_selected_model_configuration_and_resumes_generation() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, model) = setup(&app, &f).await;
    f.model.hold.store(true, Ordering::SeqCst);
    create(&app, &p, &c, "generate").await;
    wait(&app, &p, "running").await;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while f.model.calls.load(Ordering::SeqCst) < 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let(status,_)=request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{c}"),Some(json!({"expected_version":1,"name":"Changed","provider_type":"openai_compatible","base_url":f.base,"model_identifier":"different","timeout_seconds":30,"enabled":false})),None).await;
    assert_eq!(status, 200);
    app.shutdown().await.unwrap();
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let result = wait(&app, &p, "succeeded").await;
    assert_eq!(result["version"], 1);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let config: String = db
        .query_row(
            "SELECT config_id FROM outline_runs WHERE project_id=?",
            [&p],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(config, model["config_id"].as_str().unwrap());
    drop(db);
    app.shutdown().await.unwrap();
}
