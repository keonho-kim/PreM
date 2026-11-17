// Purpose: Verify common search/edit engines preserve completed work across final-stage failure.
// Pattern: Real application/model fixtures, injected SQLite failures and retained isolated storage.
// Usage: cargo nextest run --test search_edit_workflows; no production data or model calls.
// Related: V26/V28 migrations, relation_support/, presentation_support/.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod relation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use prem_backend::app::Application;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn search_publication_retry_does_not_repeat_pinned_assessments() {
    use relation_support::*;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let p = setup(&app, 2).await;
    register(&app, &f).await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_search_publish BEFORE UPDATE OF status ON relation_runs WHEN new.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END;").unwrap();
    let run = start(&app, &p, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    let failed = wait(&app, &p, id, "failed").await;
    assert_eq!(failed["steps"][0]["state"], "succeeded");
    assert_eq!(failed["steps"][1]["state"], "succeeded");
    assert_eq!(failed["steps"][2]["state"], "failed");
    let calls = f.model.calls.load(Ordering::SeqCst);
    let values = results(&app, &p, id, "file").await;
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_search_publish;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    let (s, v) = request(
        &common::router(&app),
        "POST",
        &format!("/api/v1/projects/{p}/related-searches/{id}/retry"),
        Some(json!({"expected_version":failed["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    app.start_processing();
    let done = wait(&app, &p, id, "succeeded").await;
    assert_eq!(done["steps"][1]["attempt"], 1);
    assert_eq!(done["steps"][2]["attempt"], 2);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(
        results(&app, &p, id, "file").await["items"],
        values["items"]
    );
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn edit_render_retry_reuses_proposal_and_does_not_publish_without_approval() {
    use outline_support::*;
    use presentation_support::edits::*;
    use presentation_support::*;
    let root = common::storage();
    let f = Fixture::start().await;
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let (s, v) = request(
        &common::router(&app),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let base = wait_run(&app, &p, "succeeded").await;
    let slides = slides(&app, &p, &base).await;
    let path = thread(&p, &base, &slides);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER qa_edit_render BEFORE INSERT ON presentation_edit_renders BEGIN SELECT RAISE(ABORT,'synthetic preview failure'); END;").unwrap();
    let (s, e) = request(
        &common::router(&app),
        "POST",
        &path,
        Some(json!({"expected_version":1,"prompt":"제목을 변경","fields":["title"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{e}");
    let failed = proposal(&app, &path, "failed").await;
    assert_eq!(failed["steps"][0]["state"], "succeeded");
    assert_eq!(failed["steps"][1]["state"], "failed");
    let calls = f.model.calls.load(Ordering::SeqCst);
    let spec = failed["proposal"].clone();
    app.shutdown().await.unwrap();
    db.execute_batch("DROP TRIGGER qa_edit_render;").unwrap();
    let mut app = Application::open(root.path()).unwrap();
    command(&app, &p, &failed, "retry").await;
    app.start_processing();
    let ready = proposal(&app, &path, "ready").await;
    assert_eq!(ready["steps"][0]["attempt"], 1);
    assert_eq!(ready["steps"][1]["attempt"], 2);
    assert_eq!(ready["proposal"], spec);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(
        db.query_row("SELECT version FROM presentations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_revisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    command(&app, &p, &ready, "apply").await;
    let applied = wait_run(&app, &p, "succeeded").await;
    assert_eq!(applied["presentation_version"], 2);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    app.shutdown().await.unwrap();
}
