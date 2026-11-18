// Purpose: Verify common-engine outline checkpoints, atomic publication and V24 data preservation.
// Pattern: Real HTTP/SQLite and local synthetic model; injected failures never touch app data.
// Usage: cargo nextest run --test outline_workflows; existing recovery tests cover late outputs.
// Related: outline_support/, V25 migration, outlines/execution.rs.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn retry(app: &Application, p: &str, state: &Value) {
    let (s, v) = request(
        &common::router(app),
        "POST",
        &format!(
            "/api/v1/projects/{p}/outline/runs/{}/retry",
            state["run"]["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":state["run"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
}
fn outputs(db: &rusqlite::Connection) -> Vec<(String, i64, Option<String>, Option<String>)> {
    db.prepare("SELECT run_id,batch,response_json,request_id FROM outline_run_batches ORDER BY run_id,batch").unwrap().query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn publication_failure_retries_saved_output_without_model_calls_or_revision_duplication() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_outline_publish_failure BEFORE UPDATE OF status ON outline_runs WHEN new.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic publish failure'); END;").unwrap();
    create(&app, &p, &c, "generate").await;
    let failed = wait(&app, &p, "failed").await;
    assert_eq!(failed["version"], 0);
    assert_eq!(failed["run"]["steps"][0]["state"], "succeeded");
    assert_eq!(failed["run"]["steps"][1]["state"], "failed");
    let saved = outputs(&db);
    let calls = f.model.calls.load(Ordering::SeqCst);
    assert_eq!(calls, 1);
    assert_eq!(
        db.query_row("SELECT count(*) FROM outline_revisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_outline_publish_failure;")
        .unwrap();
    let mut app = Application::open(root.path()).unwrap();
    retry(&app, &p, &failed).await;
    app.start_processing();
    let ready = wait(&app, &p, "succeeded").await;
    assert_eq!(ready["version"], 1);
    assert_eq!(ready["run"]["steps"][0]["attempt"], 1);
    assert_eq!(ready["run"]["steps"][1]["attempt"], 2);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(outputs(&db), saved);
    assert_eq!(
        db.query_row("SELECT count(*) FROM outline_revisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn migration_keeps_generated_mapping_revisions_and_canonical_batch_outputs() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    create(&app, &p, &c, "generate").await;
    wait(&app, &p, "succeeded").await;
    create(&app, &p, &c, "map").await;
    let ready = wait(&app, &p, "succeeded").await;
    let calls = f.model.calls.load(Ordering::SeqCst);
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let saved = outputs(&db);
    db.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; DROP TRIGGER slide_edit_workflow_register; DROP TRIGGER slide_edit_workflow_interrupt; DROP TABLE slide_edit_workflows; DROP TRIGGER presentation_slide_key; DROP TABLE presentation_edit_target_imports; DROP TABLE presentation_edit_imports; DROP TABLE presentation_slide_imports; DROP TABLE presentation_generation_imports; DROP TABLE presentation_reference_drafts; DROP TABLE presentation_material_imports; ALTER TABLE presentation_slide_versions DROP COLUMN slide_key; DROP TRIGGER relation_workflow_register; DROP TRIGGER relation_workflow_interrupt; DROP TABLE relation_workflows; DROP TRIGGER outline_workflow_register; DROP TRIGGER outline_workflow_interrupt; DROP TABLE outline_workflows; DELETE FROM workflow_events WHERE workflow_id LIKE 'edit:%' OR workflow_id LIKE 'relation:%'; DELETE FROM workflow_nodes WHERE workflow_id LIKE 'edit:%' OR workflow_id LIKE 'relation:%'; DELETE FROM workflow_executions WHERE id LIKE 'edit:%' OR id LIKE 'relation:%'; DELETE FROM workflow_events WHERE workflow_id LIKE 'outline:%'; DELETE FROM workflow_nodes WHERE workflow_id LIKE 'outline:%'; DELETE FROM workflow_executions WHERE id LIKE 'outline:%'; ALTER TABLE llm_provider_config_versions DROP COLUMN physical_batch_size; ALTER TABLE llm_provider_config_versions DROP COLUMN context_length; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS document_source_entries; DROP TABLE IF EXISTS document_page_alignments; DROP TABLE IF EXISTS document_alignment; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=25; PRAGMA user_version=24;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    let restored = state(&app, &p).await;
    assert_eq!(restored["revision_id"], ready["revision_id"]);
    assert_eq!(restored["draft"], ready["draft"]);
    assert!(
        restored["run"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["state"] == "succeeded")
    );
    assert_eq!(outputs(&db), saved);
    assert_eq!(
        db.query_row("SELECT count(*) FROM outline_workflows", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    app.start_processing();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn incompatible_graph_never_calls_a_model_and_interrupted_recovery_is_bounded() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    let run = create(&app, &p, &c, "generate").await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute(
        "UPDATE workflow_nodes SET node_version=99 WHERE workflow_id=? AND node_key='compose'",
        [format!("outline:{}", run["id"].as_str().unwrap())],
    )
    .unwrap();
    app.start_processing();
    let failed = wait(&app, &p, "failed").await;
    assert_eq!(failed["run"]["error_code"], "workflow_incompatible");
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    app.shutdown().await.unwrap();
    db.execute("UPDATE workflow_nodes SET node_version=1,state='running',lease='old' WHERE workflow_id=? AND node_key='compose'",[format!("outline:{}",run["id"].as_str().unwrap())]).unwrap();
    db.execute(
        "UPDATE outline_runs SET status='running',attempt=3,lease='old',lease_until=1 WHERE id=?",
        [run["id"].as_str().unwrap()],
    )
    .unwrap();
    let mut app = Application::open(root.path()).unwrap();
    let exhausted = state(&app, &p).await;
    assert_eq!(exhausted["run"]["status"], "failed");
    assert_eq!(exhausted["run"]["steps"][0]["state"], "failed");
    app.start_processing();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    assert_eq!(state(&app, &p).await["version"], 0);
    app.shutdown().await.unwrap();
}
