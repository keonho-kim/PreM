// Purpose: Verify checkpoint reuse, immutable model settings and invalid-output failure semantics.
// Pattern: Isolated SQLite plus controllable real HTTP model; all input is synthetic.
// Usage: cargo nextest run --test document_recovery.
// Related: document_support/, modules/documents/worker.rs, model_execution/.
mod common;
mod document_support;
#[allow(dead_code)] // Shared fixture module contains file formats covered by the Space suite.
mod space_support;
use common::request;
use document_support::*;
use prem_backend::app::Application;
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_resumes_batches_with_the_original_model_config() {
    let f = Fixture::start().await;
    f.model.pause_at.store(2, Ordering::SeqCst);
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let provider = configure(&app, &f).await;
    app.start_processing();
    let content = format!(
        "<html><body>{}</body></html>",
        (0..40)
            .map(|i| format!("<p>Paragraph {i}: delivery scope and schedule.</p>"))
            .collect::<String>()
    );
    let item = upload(&app, "references", "many.html", content.as_bytes()).await;
    tokio::time::timeout(Duration::from_secs(20), async {
        while f.model.calls.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    let d = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "classifying",
    )
    .await;
    assert_eq!(d["job"]["completed_blocks"], 16);
    let(s,_)=request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{provider}"),Some(json!({"expected_version":1,"name":"Changed default","provider_type":"lm_studio","base_url":f.base,"model_identifier":"changed-model","timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200);
    tokio::time::timeout(Duration::from_secs(10), app.shutdown())
        .await
        .expect("worker shutdown must join promptly")
        .unwrap();
    f.model.pause_at.store(0, Ordering::SeqCst);
    f.model.release.notify_waiters();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let done = wait(
        &app,
        "references",
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(done["job"]["id"], d["job"]["id"]);
    assert_eq!(done["job"]["extraction_id"], d["job"]["extraction_id"]);
    assert_eq!(done["job"]["config_id"], d["job"]["config_id"]);
    assert_eq!(done["job"]["completed_blocks"], 40);
    assert!(
        f.model
            .models
            .lock()
            .unwrap()
            .iter()
            .all(|m| m == "fixture")
    );
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM document_decisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        40
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM llm_requests WHERE status='running'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_llm_output_never_becomes_negative_classification() {
    let f = Fixture::start().await;
    f.model.invalid.store(true, Ordering::SeqCst);
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
    let d = wait(&app, "references", item["id"].as_str().unwrap(), "failed").await;
    assert_eq!(d["job"]["error_code"], "invalid_model_response");
    assert_eq!(d["job"]["completed_blocks"], 0);
    assert!(!d["job"]["extraction_id"].is_null());
    app.shutdown().await.unwrap();
}
