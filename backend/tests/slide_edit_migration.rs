// Purpose: Verify V19 presentation outputs acquire version memberships without changing artifacts.
// Pattern: Isolated historical-schema fixture with the same real generated PPT and Blob hashes.
// Usage: cargo nextest run --test slide_edit_migration.
// Related: V20 migration, presentation_support/, slide_edits.rs.
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
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v19_presentation_is_unchanged_after_membership_backfill() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let run = wait_run(&app, &p, "succeeded").await;
    let id = run["id"].as_str().unwrap();
    let path = format!("/api/v1/projects/{p}/presentations/{id}/slides");
    let (_, before) = request(&app.router(), "GET", &path, None, None).await;
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let hash: String = db
        .query_row(
            "SELECT output_sha256 FROM presentation_revisions WHERE id=?",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    db.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; DROP TRIGGER slide_edit_workflow_register; DROP TRIGGER slide_edit_workflow_interrupt; DROP TABLE slide_edit_workflows; DROP TRIGGER presentation_slide_key; DROP TABLE presentation_edit_target_imports; DROP TABLE presentation_edit_imports; DROP TABLE presentation_slide_imports; DROP TABLE presentation_generation_imports; DROP TABLE presentation_reference_drafts; DROP TABLE presentation_material_imports; ALTER TABLE presentation_slide_versions DROP COLUMN slide_key; DROP TRIGGER relation_workflow_register; DROP TRIGGER relation_workflow_interrupt; DROP TABLE relation_workflows; DROP TRIGGER outline_workflow_register; DROP TRIGGER outline_workflow_interrupt; DROP TABLE outline_workflows; DROP TRIGGER document_workflow_register; DROP TRIGGER document_workflow_interrupt; DROP TABLE document_workflows; DROP TABLE workflow_artifacts; DROP TABLE workflow_events; DROP TABLE workflow_nodes; DROP TABLE presentation_workflows; DROP TABLE workflow_executions; DROP TABLE presentation_edit_previews; DROP TABLE presentation_edit_renders; DROP TABLE presentation_restorations; DROP TABLE presentation_undo_stack; DROP TABLE presentation_run_sessions; DROP TABLE presentation_editor_sessions; DROP TABLE presentation_edit_target_media; DROP TABLE presentation_slide_media; DROP TABLE presentation_edit_media; DROP TABLE presentation_edit_targets; DROP TABLE presentation_media; DROP TRIGGER project_edit_cancel; DROP TABLE presentation_edit_commands; DROP TABLE presentation_edits; DROP TABLE presentation_run_slides; ALTER TABLE llm_provider_config_versions DROP COLUMN physical_batch_size; ALTER TABLE llm_provider_config_versions DROP COLUMN context_length; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS document_source_entries; DROP TABLE IF EXISTS document_page_alignments; DROP TABLE IF EXISTS document_alignment; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=20; PRAGMA user_version=19;").unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let (_, after) = request(&app.router(), "GET", &path, None, None).await;
    assert_eq!(before, after);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_run_slides", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row(
            "SELECT output_sha256 FROM presentation_revisions WHERE id=?",
            [id],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        hash
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    drop(db);
    app.shutdown().await.unwrap();
}
