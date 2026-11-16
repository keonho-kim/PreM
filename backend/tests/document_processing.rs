// Purpose: Verify end-to-end reference/template branching, extraction and durable decision recovery.
// Pattern: Isolated real application storage, actual bundled tools and deterministic local model API.
// Usage: cargo nextest run --test document_processing after preparing the runtime bundle.
// Related: document_support/, tests/fixtures/documents/, V8 migration.
mod common;
mod document_support;
#[allow(dead_code)] // Shared format fixtures are exercised by the Space suite.
mod space_support;
use common::request;
use document_support::*;
use puputyx_backend::app::Application;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn html_upload_extracts_and_classifies_once_then_survives_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    configure(&app, &f).await;
    app.start_processing();
    let item = upload(
        &app,
        "references",
        "reference.html",
        &fixture("reference.html"),
    )
    .await;
    let d = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let job = d["job"]["id"].as_str().unwrap();
    assert!(!d["template_extractable"].as_bool().unwrap());
    let (s, blocks) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/document-jobs/{job}/blocks"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200);
    let text = blocks.to_string();
    assert!(text.contains("사업 개요"));
    assert!(!text.contains("fetch("));
    assert!(!text.contains("Ignored metadata"));
    assert!(
        blocks
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["is_table_of_contents"] == 1)
    );
    let calls = f.model.calls.load(Ordering::SeqCst);
    assert_eq!(calls, 1);
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let after = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(d["job"]["extraction_id"], after["job"]["extraction_id"]);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    let key = Uuid::new_v4().to_string();
    let path = format!(
        "/api/v1/space/references/{}/processing",
        item["id"].as_str().unwrap()
    );
    let (s, new) = request(
        &app.router(),
        "POST",
        &path,
        Some(json!({"expected_version":1})),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{new}");
    let (s, replay) = request(
        &app.router(),
        "POST",
        &path,
        Some(json!({"expected_version":1})),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202);
    assert_eq!(new["id"], replay["id"]);
    let done = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(done["job"]["extraction_id"], d["job"]["extraction_id"]);
    assert_ne!(done["job"]["id"], d["job"]["id"]);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn templates_and_reference_native_materials_keep_separate_owners() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let bytes = fixture("native-template.pptx");
    let template = upload(&app, "templates", "native-template.pptx", &bytes).await;
    let d = wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert!(
        d["template"]["manifest"]["layouts"]
            .as_array()
            .unwrap()
            .len()
            > 1
    );
    assert_eq!(
        d["template"]["manifest"]["masters"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let previews = d["template"]["previews"].as_array().unwrap();
    assert_eq!(previews.len(), 2);
    let hash = previews[0]["sha256"].as_str().unwrap();
    let (status, png) = space_support::download(
        &app.router(),
        &format!(
            "/api/v1/document-jobs/{}/files/{hash}",
            d["job"]["id"].as_str().unwrap()
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert!(previews[0]["width"].as_u64().unwrap() > 0);
    assert!(d["job"]["config_id"].is_null());
    assert!(d["job"]["extraction_id"].is_null());
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    configure(&app, &f).await;
    let reference = upload(&app, "references", "native-template.pptx", &bytes).await;
    let r = wait(
        &app,
        "references",
        reference["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let (status, _) = space_support::download(
        &app.router(),
        &format!(
            "/api/v1/document-jobs/{}/files/{hash}",
            r["job"]["id"].as_str().unwrap()
        ),
    )
    .await;
    assert_eq!(
        status, 200,
        "identical reference preview bytes share a Blob only after their own extraction links it"
    );
    assert_eq!(r["template_extractable"], true);
    assert!(r["template"].is_null());
    assert!(!r["job"]["extraction_id"].is_null());
    assert!(f.model.calls.load(Ordering::SeqCst) > 0);
    let (_, templates) = request(&app.router(), "GET", "/api/v1/space/templates", None, None).await;
    assert_eq!(templates["total"], 1);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supported_documents_extract_offline_and_wait_for_an_explicit_model() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    for name in [
        "text.pdf",
        "scan.pdf",
        "office.docx",
        "sheet.xlsx",
        "korean.hwpx",
        "nested.hwp",
    ] {
        let item = upload(&app, "references", name, &fixture(name)).await;
        let d = wait(
            &app,
            "references",
            item["id"].as_str().unwrap(),
            "waiting_configuration",
        )
        .await;
        assert!(
            d["job"]["total_blocks"].as_i64().unwrap() > 0,
            "{name}: {d}"
        );
        if name.ends_with("pdf") {
            assert!(
                d["pages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|p| p["preview"].is_string()),
                "{d}"
            );
        }
        if name == "scan.pdf" {
            assert!(
                d["warnings"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("OCR_APPLIED"))
            );
        }
    }
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_fences_late_results_and_retry_reuses_extraction() {
    let f = Fixture::start().await;
    f.model.hold.store(true, Ordering::SeqCst);
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    configure(&app, &f).await;
    app.start_processing();
    let item = upload(
        &app,
        "references",
        "reference.html",
        &fixture("reference.html"),
    )
    .await;
    tokio::time::timeout(
        std::time::Duration::from_secs(20),
        f.model.entered.notified(),
    )
    .await
    .unwrap();
    let d = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "classifying",
    )
    .await;
    let job = d["job"]["id"].as_str().unwrap();
    let (s, cancelled) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/document-jobs/{job}/cancel"),
        Some(json!({"expected_version":d["job"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{cancelled}");
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
    let d2 = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "cancelled",
    )
    .await;
    assert_eq!(d2["job"]["completed_blocks"], 0);
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/document-jobs/{job}/retry"),
        Some(json!({"expected_version":d2["job"]["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200);
    let done = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(done["job"]["extraction_id"], d["job"]["extraction_id"]);
    app.shutdown().await.unwrap();
}
