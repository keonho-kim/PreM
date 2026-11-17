// Purpose: Prove common execution checkpoints recover without repeating completed PPT work.
// Pattern: Real feature/API/SQLite/process adapters; deterministic failure before atomic publication.
// Usage: cargo nextest run --test presentation_workflows; all data stays in QA storage.
// Related: workflows/engine/, V23 migration, presentation_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::*;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn retry(app: &Application, p: &str, r: &Value) {
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/retry",
            r["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":r["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn publish_retry_reuses_rendered_files_and_finished_nodes_after_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_publication_failure BEFORE INSERT ON presentation_revisions BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END;").unwrap();
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let failed = wait_run(&app, &p, "failed").await;
    assert_eq!(failed["steps"][0]["state"], "succeeded");
    assert_eq!(failed["steps"][1]["state"], "succeeded");
    assert_eq!(failed["steps"][2]["state"], "failed");
    let id = failed["id"].as_str().unwrap();
    let artifacts: i64 = db
        .query_row(
            "SELECT count(*) FROM workflow_artifacts WHERE workflow_id=?",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(artifacts, 3);
    let output: String = db
        .query_row(
            "SELECT blob_sha256 FROM workflow_artifacts WHERE workflow_id=? AND role='output'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_revisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let calls = f.model.calls.load(Ordering::SeqCst);
    let blobs: i64 = db
        .query_row("SELECT count(*) FROM file_blobs", [], |r| r.get(0))
        .unwrap();
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_publication_failure;")
        .unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    retry(&app, &p, &failed).await;
    let finished = wait_run(&app, &p, "succeeded").await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(
        db.query_row("SELECT count(*) FROM file_blobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        blobs
    );
    assert_eq!(
        db.query_row(
            "SELECT output_sha256 FROM presentation_revisions WHERE id=?",
            [id],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        output
    );
    assert_eq!(finished["steps"][0]["attempt"], 1);
    assert_eq!(finished["steps"][1]["attempt"], 1);
    assert_eq!(finished["steps"][2]["attempt"], 2);
    assert!(
        finished["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["state"] == "succeeded")
    );
    let events:Vec<String>=db.prepare("SELECT event_type FROM workflow_events WHERE workflow_id=? AND node_key='publish' ORDER BY id").unwrap().query_map([id],|r|r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert_eq!(events, ["started", "failed", "started", "succeeded"]);
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn incompatible_definition_is_visible_and_does_not_call_models() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (s, r) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let id = r["id"].as_str().unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute(
        "UPDATE workflow_executions SET definition_version=999 WHERE id=?",
        [id],
    )
    .unwrap();
    app.shutdown().await.unwrap();
    let calls = f.model.calls.load(Ordering::SeqCst);
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let failed = wait_run(&app, &p, "failed").await;
    assert_eq!(failed["error_code"], "workflow_incompatible");
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    db.execute(
        "UPDATE workflow_executions SET definition_version=1 WHERE id=?",
        [id],
    )
    .unwrap();
    retry(&app, &p, &failed).await;
    let success = wait_run(&app, &p, "succeeded").await;
    assert_eq!(success["completed"], 2);
    app.shutdown().await.unwrap();
}
