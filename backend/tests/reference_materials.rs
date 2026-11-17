// Purpose: Verify reusable reference parts, original media, ordered selections and historical lineage.
// Pattern: Real bundled extraction tools and isolated storage; no model calls or production mutations.
// Usage: cargo nextest run --test reference_materials after preparing the offline runtime.
// Related: document_support/, V11__reference_materials.sql, modules/documents/materials.rs.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use document_support::{fixture, upload, wait};
use prem_backend::app::Application;
use rusqlite::Connection;
use serde_json::{Value, json};
use std::io::{Cursor, Read};
use uuid::Uuid;
async fn catalog(app: &Application, job: &str, query: &str) -> Value {
    let (status, data) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/document-jobs/{job}/materials{query}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{data}");
    data
}
fn zip_file(bytes: &[u8], name: &str) -> Vec<u8> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut file = archive.by_name(name).unwrap();
    let mut contents = Vec::new();
    file.read_to_end(&mut contents).unwrap();
    contents
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reference_parts_preserve_native_media_and_resolve_multiple_slides_in_order() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let bytes = fixture("reference-materials.pptx");
    let item = upload(&app, "references", "reference-materials.pptx", &bytes).await;
    let detail = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(detail["reuse_ready"], true);
    assert!(detail["template"].is_null());
    let job = detail["job"]["id"].as_str().unwrap();
    let materials = catalog(&app, job, "").await;
    assert_eq!(materials["ready"], true);
    assert_eq!(materials["file_version"], 1);
    assert_eq!(materials["reference_id"], item["id"]);
    let items = materials["items"].as_array().unwrap();
    for kind in ["slide", "image", "chart", "diagram", "text"] {
        assert!(
            items.iter().any(|m| m["kind"] == kind),
            "missing {kind}: {materials}"
        );
    }
    assert!(
        !items
            .iter()
            .any(|m| m["native"]["image_part"] == "ppt/media/reference-background.png"),
        "Kordoc blank-image filtering must exclude uniform standalone image candidates"
    );
    let slides = catalog(&app, job, "?kind=slides").await;
    assert_eq!(slides["total"], 2);
    let selected = vec![
        slides["items"][1]["id"].clone(),
        slides["items"][0]["id"].clone(),
    ];
    let path = format!("/api/v1/document-jobs/{job}/materials/resolve");
    let (status, resolved) = request(
        &app.router(),
        "POST",
        &path,
        Some(json!({"material_ids":selected})),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(resolved["items"][0]["source_page"], 2);
    assert_eq!(resolved["items"][1]["source_page"], 1);
    assert_eq!(resolved["source_sha256"], materials["source_sha256"]);
    for selection in [json!([]), json!([selected[0], selected[0]])] {
        assert_eq!(
            request(
                &app.router(),
                "POST",
                &path,
                Some(json!({"material_ids":selection})),
                None
            )
            .await
            .0,
            422
        );
    }
    let bundle = materials["bundle"].as_str().unwrap();
    let (status, bundle_bytes) = space_support::download(
        &app.router(),
        &format!("/api/v1/document-jobs/{job}/files/{bundle}"),
    )
    .await;
    assert_eq!(status, 200);
    let manifest: Value =
        serde_json::from_slice(&zip_file(&bundle_bytes, "analysis/manifest.json")).unwrap();
    let background = manifest["images"]["imageMap"]["ppt/media/reference-background.png"]
        .as_str()
        .unwrap();
    let background = if background.starts_with("images/") {
        background.to_owned()
    } else {
        format!("images/{background}")
    };
    assert_eq!(
        zip_file(&bundle_bytes, &background),
        zip_file(&bytes, "ppt/media/reference-background.png"),
        "filtering candidates must preserve native source media"
    );
    let image = items
        .iter()
        .find(|m| m["kind"] == "image" && m["native"]["image_asset"].is_string())
        .unwrap();
    assert_eq!(
        zip_file(
            &bundle_bytes,
            image["native"]["image_asset"].as_str().unwrap()
        ),
        zip_file(&bytes, image["native"]["image_part"].as_str().unwrap())
    );
    let chart = items.iter().find(|m| m["kind"] == "chart").unwrap();
    assert!(!chart["native"]["shape_ids"].as_array().unwrap().is_empty());
    let image_hash = image["preview"].as_str().unwrap();
    let (status, png) = space_support::download(
        &app.router(),
        &format!("/api/v1/document-jobs/{job}/files/{image_hash}"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    let text = catalog(&app, job, "?kind=text&q=Contents").await;
    assert!(text["total"].as_i64().unwrap() > 0);
    assert!(
        text["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["content_block_id"].is_string())
    );
    let other = upload(&app, "references", "text.pdf", &fixture("text.pdf")).await;
    let other_detail = wait(
        &app,
        "references",
        other["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let other_job = other_detail["job"]["id"].as_str().unwrap();
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &format!("/api/v1/document-jobs/{other_job}/materials/resolve"),
            Some(json!({"material_ids":selected})),
            None
        )
        .await
        .0,
        404
    );
    assert_eq!(
        space_support::download(
            &app.router(),
            &format!("/api/v1/document-jobs/{other_job}/files/{bundle}")
        )
        .await
        .0,
        404
    );
    let pages = catalog(&app, other_job, "?kind=slides").await;
    assert_eq!(pages["items"][0]["kind"], "page");
    assert!(pages["bundle"].is_null());
    let (_, templates) = request(&app.router(), "GET", "/api/v1/space/templates", None, None).await;
    assert_eq!(templates["total"], 0);
    let original_extraction = materials["extraction_id"].clone();
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    assert_eq!(catalog(&app, job, "").await, materials);
    let (cancelled, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/document-jobs/{job}/cancel"),
        Some(json!({"expected_version":detail["job"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(cancelled, 409, "completed preparation remains terminal");
    let (status, new_job) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/space/references/{}/processing",
            item["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":1})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202, "{new_job}");
    let after = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(after["job"]["id"], new_job["id"]);
    assert_eq!(after["job"]["extraction_id"], original_extraction);
    assert_eq!(
        catalog(&app, new_job["id"].as_str().unwrap(), "").await["items"],
        materials["items"]
    );
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn migration_preserves_old_extractions_until_explicit_material_preparation() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let item = upload(
        &app,
        "references",
        "reference.html",
        &fixture("reference.html"),
    )
    .await;
    let detail = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let job = detail["job"]["id"].as_str().unwrap();
    let extraction = detail["job"]["extraction_id"].as_str().unwrap();
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("DROP TABLE presentation_render_layers; DROP TABLE presentation_canvas_commands; DROP TABLE presentation_manual_designs; DROP TABLE presentation_quality_checks; DROP TABLE presentation_render_cache; DROP TRIGGER slide_edit_workflow_register; DROP TRIGGER slide_edit_workflow_interrupt; DROP TABLE slide_edit_workflows; DROP TRIGGER presentation_slide_key; DROP TABLE presentation_edit_target_imports; DROP TABLE presentation_edit_imports; DROP TABLE presentation_slide_imports; DROP TABLE presentation_generation_imports; DROP TABLE presentation_reference_drafts; DROP TABLE presentation_material_imports; ALTER TABLE presentation_slide_versions DROP COLUMN slide_key; DROP TRIGGER relation_workflow_register; DROP TRIGGER relation_workflow_interrupt; DROP TABLE relation_workflows; DROP TRIGGER outline_workflow_register; DROP TRIGGER outline_workflow_interrupt; DROP TABLE outline_workflows; DROP TRIGGER document_workflow_register; DROP TRIGGER document_workflow_interrupt; DROP TABLE document_workflows; DROP TABLE workflow_artifacts; DROP TABLE workflow_events; DROP TABLE workflow_nodes; DROP TABLE presentation_workflows; DROP TABLE workflow_executions; DROP TABLE presentation_edit_previews; DROP TABLE presentation_edit_renders; DROP TABLE presentation_restorations; DROP TABLE presentation_undo_stack; DROP TABLE presentation_run_sessions; DROP TABLE presentation_editor_sessions; DROP TABLE presentation_edit_target_media; DROP TABLE presentation_slide_media; DROP TABLE presentation_edit_media; DROP TABLE presentation_edit_targets; DROP TABLE presentation_media; DROP TRIGGER project_edit_cancel; DROP TABLE presentation_edit_commands; DROP TABLE presentation_edits; DROP TABLE presentation_run_slides; DROP TRIGGER project_presentation_cancel; DROP TABLE presentation_commands; DROP TABLE presentation_revision_slides; DROP TABLE presentation_revisions; DROP TABLE presentation_slide_evidence; DROP TABLE presentation_slide_versions; DROP TABLE presentation_runs; DROP TABLE presentations; DROP TABLE presentation_preparations; DROP TABLE presentation_designs; DROP TABLE presentation_evidence_links; DROP TABLE presentation_evidence_reviews; DROP TABLE relation_workspace_peers; DROP TABLE relation_pulls; DROP TABLE relation_review_history; DROP TABLE relation_reads; DROP TABLE relation_workspaces; DROP TRIGGER project_outline_cancel; DROP TABLE outline_run_commands; DROP TABLE outline_run_batches; DROP TABLE outline_run_blocks; DROP TABLE outline_runs; DROP TABLE outline_confirmations; DROP TABLE outline_assignments; DROP TABLE outline_revision_nodes; DROP TABLE outline_node_versions; DROP TABLE outline_nodes; DROP TABLE outline_heads; DROP TABLE outline_revisions; DROP VIEW registered_file_facts; DROP TRIGGER relation_project_cancel; DROP TABLE relation_link_changes; DROP TABLE relation_links; DROP TABLE relation_commands; DROP TABLE relation_origins; DROP TABLE relation_candidates; DROP TABLE relation_assessments; DROP TABLE relation_sources; DROP TABLE relation_runs; DROP TABLE relation_settings; DROP INDEX job_extraction_lookup; DROP TRIGGER source_document_job; DROP TRIGGER source_document_cancel; DROP TRIGGER project_source_cancel; DROP TABLE project_source_review_files; DROP TABLE project_source_reviews; DROP TABLE project_guide_revisions; DROP TABLE source_versions; DROP TABLE source_items; DROP TABLE template_import_links; DROP TABLE ppt_imports; DROP TABLE asset_package_members; DROP TABLE blob_collection_candidates; DROP TABLE document_materials; DROP TABLE document_native_packages; DROP INDEX document_page_identity; DROP INDEX document_block_identity; ALTER TABLE llm_provider_config_versions DROP COLUMN max_output_tokens; DROP TABLE IF EXISTS decision_settings; DELETE FROM refinery_schema_history WHERE version>=11; PRAGMA user_version=10; UPDATE document_extractions SET schema_version=1,profile='legacy-v1'; UPDATE document_jobs SET status='succeeded',profile='legacy-v1';").unwrap();
    let text: String = db
        .query_row(
            "SELECT group_concat(text) FROM (SELECT text FROM content_blocks ORDER BY id)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    drop(db);
    let mut app = Application::open(root.path()).unwrap();
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let old = catalog(&app, job, "").await;
    assert_eq!(old["ready"], false);
    assert_eq!(old["total"], 0);
    let (status, new) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/space/references/{}/processing",
            item["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":1})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202);
    let prepared = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(prepared["job"]["id"], new["id"]);
    assert_ne!(prepared["job"]["extraction_id"], extraction);
    assert_eq!(
        catalog(&app, new["id"].as_str().unwrap(), "").await["ready"],
        true
    );
    assert_eq!(catalog(&app, job, "").await["ready"], false);
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(db.query_row("SELECT group_concat(text) FROM (SELECT b.text FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE p.extraction_id=? ORDER BY b.id)",[extraction],|r|r.get::<_,String>(0)).unwrap(),text);
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}
