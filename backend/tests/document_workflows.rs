// Purpose: Verify document/template engine checkpoints, readiness failure recovery and old-data backfill.
// Pattern: Actual upload/extraction/model/SQLite APIs with synthetic inputs and isolated QA storage.
// Usage: cargo nextest run --test document_workflows; no real model or production data is used.
// Related: V24 migration, document_support/, documents/execution.rs.
mod common;
mod document_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use document_support::*;
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::{sync::atomic::Ordering, time::Duration};
use uuid::Uuid;
async fn wait_status(app: &Application, id: &str, status: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let (s, d) = request(
                &app.router(),
                "GET",
                &format!("/api/v1/space/references/{id}/processing"),
                None,
                None,
            )
            .await;
            assert_eq!(s, 200, "{d}");
            if d["job"]["status"] == status {
                return d;
            }
            assert!(status == "failed" || d["job"]["status"] != "failed", "{d}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap()
}
async fn retry(app: &Application, d: &Value) {
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/document-jobs/{}/retry",
            d["job"]["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":d["job"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn waiting_model_and_publish_failure_reuse_extraction_decisions_and_search_after_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let item = upload(
        &app,
        "references",
        "engine.md",
        b"# workflowneedle\n\nDocument engine checkpoint data.",
    )
    .await;
    let id = item["id"].as_str().unwrap();
    let waiting = wait_status(&app, id, "waiting_configuration").await;
    assert!(waiting["job"]["extraction_id"].is_null());
    assert_eq!(waiting["job"]["steps"][1]["state"], "pending");
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);

    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_document_ready_failure BEFORE UPDATE OF status ON document_jobs WHEN new.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic ready failure'); END;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    configure(&app, &f).await;
    app.start_processing();
    let failed = wait_status(&app, id, "failed").await;
    assert_eq!(failed["job"]["steps"][0]["attempt"], 1);
    assert_eq!(failed["job"]["steps"][1]["state"], "succeeded");
    assert_eq!(failed["job"]["steps"][2]["state"], "failed");
    let extraction = failed["job"]["extraction_id"].clone();
    assert!(extraction.is_string());
    let calls = f.model.calls.load(Ordering::SeqCst);
    let count: i64 = db
        .query_row("SELECT count(*) FROM content_blocks", [], |r| r.get(0))
        .unwrap();
    let decisions: i64 = db
        .query_row("SELECT count(*) FROM document_decisions", [], |r| r.get(0))
        .unwrap();
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_document_ready_failure;")
        .unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    retry(&app, &failed).await;
    let done = wait_status(&app, id, "succeeded").await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(done["job"]["extraction_id"], extraction);
    assert_eq!(done["job"]["steps"][1]["attempt"], 1);
    assert_eq!(done["job"]["steps"][2]["attempt"], 2);
    assert!(
        done["job"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["state"] == "succeeded")
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM content_blocks", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM document_decisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        decisions
    );
    let (s, found) = request(
        &app.router(),
        "GET",
        "/api/v1/search?q=workflowneedle&scope=references&mode=content",
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{found}");
    assert_eq!(found["total"], 1);
    let duplicate = upload(
        &app,
        "references",
        "same.md",
        b"# workflowneedle\n\nDocument engine checkpoint data.",
    )
    .await;
    let reused = wait_status(&app, duplicate["id"].as_str().unwrap(), "succeeded").await;
    assert_eq!(reused["job"]["extraction_id"], extraction);
    assert_eq!(
        db.query_row("SELECT count(*) FROM document_extractions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM content_blocks", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    let template = upload(
        &app,
        "templates",
        "team.pptx",
        &fixture("native-template.pptx"),
    )
    .await;
    let ready = wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let steps = ready["job"]["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 2);
    assert!(
        steps
            .iter()
            .all(|s| s["key"] != "classify" && s["state"] == "succeeded")
    );
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
async fn migration_backfills_completed_documents_and_templates_without_regeneration() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let item = upload(
        &app,
        "references",
        "cache.md",
        b"# cache\n\nKeep old extracted content.",
    )
    .await;
    let waiting = wait_status(&app, item["id"].as_str().unwrap(), "waiting_configuration").await;
    let template = upload(
        &app,
        "templates",
        "team.pptx",
        &fixture("native-template.pptx"),
    )
    .await;
    let ready = wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let count: i64 = db
        .query_row("SELECT count(*) FROM file_blobs", [], |r| r.get(0))
        .unwrap();
    db.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; DROP TRIGGER slide_edit_workflow_register; DROP TRIGGER slide_edit_workflow_interrupt; DROP TABLE slide_edit_workflows; DROP TRIGGER presentation_slide_key; DROP TABLE presentation_edit_target_imports; DROP TABLE presentation_edit_imports; DROP TABLE presentation_slide_imports; DROP TABLE presentation_generation_imports; DROP TABLE presentation_reference_drafts; DROP TABLE presentation_material_imports; ALTER TABLE presentation_slide_versions DROP COLUMN slide_key; DROP TRIGGER relation_workflow_register; DROP TRIGGER relation_workflow_interrupt; DROP TABLE relation_workflows; DROP TRIGGER outline_workflow_register; DROP TRIGGER outline_workflow_interrupt; DROP TABLE outline_workflows; DROP TRIGGER document_workflow_register; DROP TRIGGER document_workflow_interrupt; DROP TABLE document_workflows; DELETE FROM workflow_events WHERE workflow_id LIKE 'edit:%' OR workflow_id LIKE 'relation:%'; DELETE FROM workflow_nodes WHERE workflow_id LIKE 'edit:%' OR workflow_id LIKE 'relation:%'; DELETE FROM workflow_executions WHERE id LIKE 'edit:%' OR id LIKE 'relation:%'; DELETE FROM workflow_events WHERE workflow_id LIKE 'document:%'; DELETE FROM workflow_nodes WHERE workflow_id LIKE 'document:%'; DELETE FROM workflow_executions WHERE id LIKE 'document:%'; ALTER TABLE llm_provider_config_versions DROP COLUMN physical_batch_size; ALTER TABLE llm_provider_config_versions DROP COLUMN context_length; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS document_source_entries; DROP TABLE IF EXISTS document_page_alignments; DROP TABLE IF EXISTS document_alignment; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=24; PRAGMA user_version=23;").unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let restored = wait_status(&app, item["id"].as_str().unwrap(), "waiting_configuration").await;
    assert_eq!(
        restored["job"]["extraction_id"],
        waiting["job"]["extraction_id"]
    );
    assert!(restored["job"]["extraction_id"].is_null());
    let template_again = wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(template_again["template_bundle"], ready["template_bundle"]);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM file_blobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
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
async fn unsupported_definition_never_extracts_or_calls_models() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    configure(&app, &f).await;
    let item = upload(
        &app,
        "references",
        "later.md",
        b"# later\n\nNo premature execution.",
    )
    .await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute(
        "UPDATE workflow_executions SET definition_version=999 WHERE definition_key='document'",
        [],
    )
    .unwrap();
    app.start_processing();
    let failed = wait_status(&app, item["id"].as_str().unwrap(), "failed").await;
    assert_eq!(failed["job"]["error_code"], "workflow_incompatible");
    assert_eq!(failed["job"]["extraction_id"], Value::Null);
    assert_eq!(
        db.query_row("SELECT count(*) FROM llm_requests", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    app.shutdown().await.unwrap();
}
