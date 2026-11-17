// Purpose: Verify shared PPT imports, member deduplication, deterministic downloads and legacy upgrades.
// Pattern: Real bundled tools with isolated storage; original files and old results remain readable.
// Usage: cargo nextest run --test shared_ppt_storage after runtime preparation.
// Related: V12__shared_ppt_packages.sql, reference_materials.rs, document_support/.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod space_support;
use document_support::{fixture, upload, wait};
use prem_backend::app::Application;
use rusqlite::{Connection, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
fn db(root: &std::path::Path) -> Connection {
    Connection::open(root.join("db/app.sqlite")).unwrap()
}
fn write_blob(root: &std::path::Path, bytes: &[u8], mime: &str) -> String {
    let hash = hex::encode(Sha256::digest(bytes));
    let path = root
        .join("blobs/sha256")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(&hash);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
    db(root)
        .execute(
            "INSERT OR IGNORE INTO file_blobs VALUES(?,?,?,'zip',1)",
            params![hash, bytes.len() as i64, mime],
        )
        .unwrap();
    hash
}
async fn bundle(app: &Application, job: &str, hash: &str) -> Vec<u8> {
    let (status, bytes) = space_support::download(
        &app.router(),
        &format!("/api/v1/document-jobs/{job}/files/{hash}"),
    )
    .await;
    assert_eq!(status, 200);
    bytes
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_library_roles_share_one_import_and_survive_restart() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    let bytes = fixture("reference-materials.pptx");
    let reference = upload(&app, "references", "reference.pptx", &bytes).await;
    let template = upload(&app, "templates", "template.pptx", &bytes).await;
    app.start_processing();
    let r = wait(
        &app,
        "references",
        reference["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let t = wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let job = t["job"]["id"].as_str().unwrap();
    let hash = t["template_bundle"].as_str().unwrap();
    let connection = db(root.path());
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM ppt_imports", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM template_extractions", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0,
        "new templates must not copy structure JSON to the legacy table"
    );
    let reference_package: String = connection
        .query_row(
            "SELECT bundle_blob_sha256 FROM document_native_packages WHERE extraction_id=?",
            [r["job"]["extraction_id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(reference_package, hash);
    let path = root
        .path()
        .join("blobs/sha256")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(hash);
    let manifest: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(manifest["schema_version"], 1);
    for f in manifest["files"].as_array().unwrap() {
        let h = f["sha256"].as_str().unwrap();
        if f["size"] == 0 {
            continue;
        }
        let bytes = std::fs::read(
            root.path()
                .join("blobs/sha256")
                .join(&h[..2])
                .join(&h[2..4])
                .join(h),
        )
        .unwrap();
        assert_eq!(hex::encode(Sha256::digest(&bytes)), h);
    }
    let first = bundle(&app, job, hash).await;
    assert_eq!(
        bundle(&app, job, hash).await,
        first,
        "ZIP bytes must not depend on wall clock or temporary paths"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM file_blobs WHERE detected_mime='application/zip'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0,
        "download ZIPs are transient"
    );
    drop(connection);
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    assert_eq!(bundle(&app, job, hash).await, first);
    let second = upload(&app, "templates", "again.pptx", &bytes).await;
    let after = wait(
        &app,
        "templates",
        second["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(after["template_bundle"], hash);
    assert_eq!(after["template"], t["template"]);
    assert_eq!(
        db(root.path())
            .query_row("SELECT count(*) FROM ppt_imports", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    // Distinct PPTX bytes with the same embedded artwork share member Blobs across packages.
    let mut writer = zip::ZipWriter::new_append(std::io::Cursor::new(bytes.clone())).unwrap();
    writer
        .set_comment("another original with the same artwork")
        .unwrap();
    let variant = writer.finish().unwrap().into_inner();
    let changed = upload(&app, "templates", "different.pptx", &variant).await;
    let changed = wait(
        &app,
        "templates",
        changed["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_ne!(changed["template_bundle"], hash);
    let connection = db(root.path());
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM ppt_imports", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(connection.query_row("SELECT count(*) FROM (SELECT blob_sha256 FROM asset_package_members WHERE path LIKE 'images/%' GROUP BY blob_sha256 HAVING count(DISTINCT package_sha256)=2)",[],|r|r.get::<_,i64>(0)).unwrap()>0);
    drop(connection);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v11_zip_and_template_json_remain_readable_after_additive_migration() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let item = upload(
        &app,
        "templates",
        "legacy.pptx",
        &fixture("native-template.pptx"),
    )
    .await;
    let detail = wait(&app, "templates", item["id"].as_str().unwrap(), "succeeded").await;
    let job = detail["job"]["id"].as_str().unwrap();
    let zip = bundle(&app, job, detail["template_bundle"].as_str().unwrap()).await;
    app.shutdown().await.unwrap();
    let hash = write_blob(root.path(), &zip, "application/zip");
    let connection = db(root.path());
    connection
        .execute(
            "INSERT INTO template_extractions VALUES(?,?,?,1,?,?,?,1)",
            params![
                job,
                detail["job"]["source_sha256"].as_str().unwrap(),
                detail["job"]["profile"].as_str().unwrap(),
                detail["template"]["manifest"].to_string(),
                detail["template"]["native_structure"].to_string(),
                hash
            ],
        )
        .unwrap();
    for p in detail["template"]["previews"].as_array().unwrap() {
        connection
            .execute(
                "INSERT INTO template_previews VALUES(?,?,?,?,?)",
                params![
                    job,
                    p["ordinal"].as_i64().unwrap(),
                    p["sha256"].as_str().unwrap(),
                    p["width"].as_i64().unwrap(),
                    p["height"].as_i64().unwrap()
                ],
            )
            .unwrap();
    }
    connection.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; DROP TRIGGER slide_edit_workflow_register; DROP TRIGGER slide_edit_workflow_interrupt; DROP TABLE slide_edit_workflows; DROP TRIGGER presentation_slide_key; DROP TABLE presentation_edit_target_imports; DROP TABLE presentation_edit_imports; DROP TABLE presentation_slide_imports; DROP TABLE presentation_generation_imports; DROP TABLE presentation_reference_drafts; DROP TABLE presentation_material_imports; ALTER TABLE presentation_slide_versions DROP COLUMN slide_key; DROP TRIGGER relation_workflow_register; DROP TRIGGER relation_workflow_interrupt; DROP TABLE relation_workflows; DROP TRIGGER outline_workflow_register; DROP TRIGGER outline_workflow_interrupt; DROP TABLE outline_workflows; DROP TRIGGER document_workflow_register; DROP TRIGGER document_workflow_interrupt; DROP TABLE document_workflows; DROP TABLE workflow_artifacts; DROP TABLE workflow_events; DROP TABLE workflow_nodes; DROP TABLE presentation_workflows; DROP TABLE workflow_executions; DROP TABLE presentation_edit_previews; DROP TABLE presentation_edit_renders; DROP TABLE presentation_restorations; DROP TABLE presentation_undo_stack; DROP TABLE presentation_run_sessions; DROP TABLE presentation_editor_sessions; DROP TABLE presentation_edit_target_media; DROP TABLE presentation_slide_media; DROP TABLE presentation_edit_media; DROP TABLE presentation_edit_targets; DROP TABLE presentation_media; DROP TRIGGER project_edit_cancel; DROP TABLE presentation_edit_commands; DROP TABLE presentation_edits; DROP TABLE presentation_run_slides; DROP TRIGGER project_presentation_cancel; DROP TABLE presentation_commands; DROP TABLE presentation_revision_slides; DROP TABLE presentation_revisions; DROP TABLE presentation_slide_evidence; DROP TABLE presentation_slide_versions; DROP TABLE presentation_runs; DROP TABLE presentations; DROP TABLE presentation_preparations; DROP TABLE presentation_designs; DROP TABLE presentation_evidence_links; DROP TABLE presentation_evidence_reviews; DROP TABLE relation_workspace_peers; DROP TABLE relation_pulls; DROP TABLE relation_review_history; DROP TABLE relation_reads; DROP TABLE relation_workspaces; DROP TRIGGER project_outline_cancel; DROP TABLE outline_run_commands; DROP TABLE outline_run_batches; DROP TABLE outline_run_blocks; DROP TABLE outline_runs; DROP TABLE outline_confirmations; DROP TABLE outline_assignments; DROP TABLE outline_revision_nodes; DROP TABLE outline_node_versions; DROP TABLE outline_nodes; DROP TABLE outline_heads; DROP TABLE outline_revisions; DROP VIEW registered_file_facts; DROP TRIGGER relation_project_cancel; DROP TABLE relation_link_changes; DROP TABLE relation_links; DROP TABLE relation_commands; DROP TABLE relation_origins; DROP TABLE relation_candidates; DROP TABLE relation_assessments; DROP TABLE relation_sources; DROP TABLE relation_runs; DROP TABLE relation_settings; DROP INDEX job_extraction_lookup; DROP TRIGGER source_document_job; DROP TRIGGER source_document_cancel; DROP TRIGGER project_source_cancel; DROP TABLE project_source_review_files; DROP TABLE project_source_reviews; DROP TABLE project_guide_revisions; DROP TABLE source_versions; DROP TABLE source_items; DROP TABLE template_import_links; DROP TABLE ppt_imports; DROP TABLE asset_package_members; DROP TABLE blob_collection_candidates; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=12; PRAGMA user_version=11;").unwrap();
    drop(connection);
    let app = Application::open(root.path()).unwrap();
    let (status, after) = common::request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/space/templates/{}/processing",
            item["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(after["template"], detail["template"]);
    assert_eq!(after["template_bundle"], hash);
    assert_eq!(bundle(&app, job, &hash).await, zip);
    assert_eq!(
        std::fs::read_dir(root.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
    app.shutdown().await.unwrap();
}
