// Purpose: Verify real authoring calls use immutable per-model output budgets and preserve legacy defaults.
// Pattern: HTTP/SQLite plus a held compatible model request; no cloud or application data.
// Usage: cargo nextest run --test model_output_budget.
// Related: V32 migration, inference/execution.rs, outline_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use common::{request, router};
use outline_support::*;
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn admit(app: &Application, project: &str, connection: &str, model: i64) {
    let s = state(app, project).await;
    let (status, value) = request(&router(app), "POST", &format!("/api/v1/projects/{project}/outline/runs"),
        Some(json!({"expected_version":s["version"],"source_snapshot":s["source_snapshot"],"guide_version":s["guide_version"],"connection_id":connection,"model_version":model,"kind":"generate","node_ids":[]})), Some(&Uuid::new_v4().to_string())).await;
    assert_eq!(status, 202, "{value}");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn budget_updates_do_not_change_running_authoring_and_survive_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, original) = setup(&app, &f).await;
    assert!(original["max_output_tokens"].is_null());
    let path = format!("/api/v1/admin/llm/providers/{c}");
    let mut input = json!({"expected_version":1,"name":"작성 AI","provider_type":"openai_compatible","base_url":f.base,"model_identifier":"fixture","timeout_seconds":600,"enabled":true,"max_output_tokens":30000});
    for bad in [json!(0), json!(65537), json!(3.5)] {
        input["max_output_tokens"] = bad;
        let (status, _) = request(&router(&app), "PUT", &path, Some(input.clone()), None).await;
        assert!(!status.is_success());
    }
    input["max_output_tokens"] = json!(30000);
    let (status, saved) = request(&router(&app), "PUT", &path, Some(input.clone()), None).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["max_output_tokens"], 30000);
    f.model.hold.store(true, Ordering::SeqCst);
    admit(&app, &p, &c, 2).await;
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        f.model.entered.notified(),
    )
    .await
    .unwrap();
    input["expected_version"] = json!(2);
    input["max_output_tokens"] = json!(6144);
    let (status, _) = request(&router(&app), "PUT", &path, Some(input), None).await;
    assert_eq!(status, 200);
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_one();
    wait(&app, &p, "succeeded").await;
    assert_eq!(*f.model.budgets.lock().unwrap(), vec![30000]);
    admit(&app, &p, &c, 3).await;
    wait(&app, &p, "succeeded").await;
    assert_eq!(*f.model.budgets.lock().unwrap(), vec![30000, 6144]);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, value): (_, Value) = request(&router(&app), "GET", &path, None, None).await;
    assert_eq!(value["version"], 3);
    assert_eq!(value["max_output_tokens"], 6144);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT max_output_tokens FROM llm_provider_config_versions WHERE id=?",
            [saved["config_id"].as_str().unwrap()],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        30000
    );
    app.shutdown().await.unwrap();
}
