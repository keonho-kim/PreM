// Purpose: Prove per-slide render reuse survives a failed later checkpoint and server restart.
// Pattern: Actual API/SQLite/native tools with synthetic text and a deterministic commit failure.
// Usage: cargo nextest run --test presentation_quality; QA storage is isolated from application data.
// Related: V29 migration, presentations/quality.rs, presentation_support/.
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
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn successful_slide_is_reused_after_later_render_commit_failure_and_restart() {
    let fixture = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (project, connection, _) = setup(&app, &fixture).await;
    let design = prepared(&app, &project, &connection).await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_slide_failure BEFORE INSERT ON presentation_quality_checks WHEN new.position=2 BEGIN SELECT RAISE(ABORT,'synthetic second slide checkpoint failure'); END;").unwrap();
    let (status, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{project}/presentations"),
        Some(input(&design, &connection)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202);
    let failed = wait_run(&app, &project, "failed").await;
    assert_eq!(failed["quality"].as_array().unwrap().len(), 1);
    assert_eq!(failed["quality"][0]["report"]["passed"], true);
    let (hash, preview): (String, String) = db
        .query_row(
            "SELECT output_sha256,preview_sha256 FROM presentation_render_cache",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let calls = fixture.model.calls.load(Ordering::SeqCst);
    let initial_specs: Vec<String> = db
        .prepare("SELECT spec_sha256 FROM presentation_slide_versions ORDER BY position")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_slide_failure;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (status, value) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{project}/presentations/{}/retry",
            failed["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":failed["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 200, "{value}");
    let completed = wait_run(&app, &project, "succeeded").await;
    assert_eq!(completed["quality"].as_array().unwrap().len(), 2);
    assert_eq!(completed["quality"][0]["reused"], true);
    assert_eq!(completed["quality"][1]["reused"], false);
    assert_eq!(fixture.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(db.query_row("SELECT count(*) FROM presentation_render_cache WHERE output_sha256=? AND preview_sha256=?",[hash,preview],|r|r.get::<_,i64>(0)).unwrap(),1);
    let specs: Vec<String> = db
        .prepare("SELECT spec_sha256 FROM presentation_slide_versions ORDER BY position")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(specs, initial_specs);
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    // Migration from the previous release adds no replacement output or model work.
    app.shutdown().await.unwrap();
    let bytes_before: Vec<String> = db
        .prepare("SELECT sha256 FROM file_blobs ORDER BY sha256")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    db.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; ALTER TABLE llm_provider_config_versions DROP COLUMN physical_batch_size; ALTER TABLE llm_provider_config_versions DROP COLUMN context_length; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS document_source_entries; DROP TABLE IF EXISTS document_page_alignments; DROP TABLE IF EXISTS document_alignment; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=29; PRAGMA user_version=28;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let preserved = wait_run(&app, &project, "succeeded").await;
    assert_eq!(preserved["id"], completed["id"]);
    assert!(preserved["quality"].as_array().unwrap().is_empty());
    assert_eq!(fixture.model.calls.load(Ordering::SeqCst), calls);
    let bytes_after: Vec<String> = db
        .prepare("SELECT sha256 FROM file_blobs ORDER BY sha256")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(bytes_before, bytes_after);
    app.shutdown().await.unwrap();
}
