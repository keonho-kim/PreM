// Purpose: Verify scoped LLM proposals, explicit application and immutable slide/version reuse.
// Pattern: Real application/renderer with synthetic model responses and isolated persistent storage.
// Usage: cargo nextest run --test slide_edits; live Ornith coverage is a separate explicit journey.
// Related: presentation_support/, outline_support/, V20 migration.
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
use std::{sync::atomic::Ordering, time::Duration};
use uuid::Uuid;
async fn deck(app: &Application, f: &Fixture) -> (String, String, Value, Value) {
    let (p, c, _) = setup(app, f).await;
    let design = prepared(app, &p, &c).await;
    let (s, r) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{r}");
    let run = wait_run(app, &p, "succeeded").await;
    let (_, slides) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/slides",
            run["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    (p, c, run, slides)
}
fn thread(p: &str, run: &Value, slides: &Value) -> String {
    format!(
        "/api/v1/projects/{p}/presentations/{}/slides/{}/edits",
        run["id"].as_str().unwrap(),
        slides[0]["id"].as_str().unwrap()
    )
}
fn edit_input(run: &Value, c: &str) -> Value {
    json!({"expected_version":run["presentation_version"],"connection_id":c,"model_version":1,"prompt":"제목을 간결하게 바꿔주세요. 본문과 메모는 유지하세요.","fields":["title"]})
}
async fn wait_edit(app: &Application, path: &str, status: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let (s, rows) = request(&app.router(), "GET", path, None, None).await;
            assert_eq!(s, 200, "{rows}");
            if let Some(e) = rows.as_array().unwrap().last() {
                if e["status"] == status {
                    return e.clone();
                }
                assert!(e["status"] != "failed" || status == "failed", "{e}");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap()
}
async fn control(
    app: &Application,
    p: &str,
    e: &Value,
    action: &str,
    key: &str,
) -> (axum::http::StatusCode, Value) {
    request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/slide-edits/{}/{action}",
            e["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":e["version"]})),
        Some(key),
    )
    .await
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn title_proposal_is_reviewed_before_apply_and_reuses_other_slide_versions() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, original, slides) = deck(&app, &f).await;
    let path = thread(&p, &original, &slides);
    let key = Uuid::new_v4().to_string();
    let (s, first) = request(
        &app.router(),
        "POST",
        &path,
        Some(edit_input(&original, &c)),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{first}");
    let (_, replay) = request(
        &app.router(),
        "POST",
        &path,
        Some(edit_input(&original, &c)),
        Some(&key),
    )
    .await;
    assert_eq!(first["id"], replay["id"]);
    let proposal = wait_edit(&app, &path, "ready").await;
    assert_eq!(proposal["proposal"]["title"], "수정된 제목");
    assert_eq!(
        proposal["proposal"]["bullets"],
        slides[0]["spec"]["bullets"]
    );
    assert_eq!(proposal["proposal"]["notes"], slides[0]["spec"]["notes"]);
    assert_eq!(
        proposal["proposal"]["block_ids"],
        slides[0]["spec"]["block_ids"]
    );
    let (_, before) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations"),
        None,
        None,
    )
    .await;
    assert_eq!(before.as_array().unwrap().len(), 1);
    assert_eq!(before[0]["presentation_version"], 1);
    let (_, second) = request(
        &app.router(),
        "POST",
        &path,
        Some(edit_input(&original, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_ne!(first["id"], second["id"]);
    let alternate = wait_edit(&app, &path, "ready").await;
    let calls = f.model.calls.load(Ordering::SeqCst);
    let apply_key = Uuid::new_v4().to_string();
    let (s, applying) = control(&app, &p, &proposal, "apply", &apply_key).await;
    assert_eq!(s, 200, "{applying}");
    assert_eq!(applying["status"], "applying");
    let (_, same) = control(&app, &p, &proposal, "apply", &apply_key).await;
    assert_eq!(same["applied_run_id"], applying["applied_run_id"]);
    let output = wait_run(&app, &p, "succeeded").await;
    assert_eq!(output["presentation_version"], 2);
    assert_eq!(
        f.model.calls.load(Ordering::SeqCst),
        calls,
        "Applying a proposal must not generate unchanged content again"
    );
    let new_id = output["id"].as_str().unwrap();
    let (_, edited) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations/{new_id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(edited[0]["spec"]["title"], "수정된 제목");
    assert_ne!(edited[0]["id"], slides[0]["id"]);
    assert_eq!(edited[1]["id"], slides[1]["id"]);
    assert_eq!(edited[1]["spec"], slides[1]["spec"]);
    let (s, _) = control(&app, &p, &alternate, "apply", &Uuid::new_v4().to_string()).await;
    assert_eq!(s, 409);
    let (_, old) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/slides",
            original["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(old, slides);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM presentation_slide_versions",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        3
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
    let app = Application::open(root.path()).unwrap();
    let (_, history) = request(
        &app.router(),
        "GET",
        &thread(&p, &output, &edited),
        None,
        None,
    )
    .await;
    assert_eq!(history[0]["status"], "applied");
    let (s, bytes) = space_support::download(
        &app.router(),
        &format!("/api/v1/projects/{p}/presentations/{new_id}/download"),
    )
    .await;
    assert_eq!(s, 200);
    assert!(bytes.starts_with(b"PK"));
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scope_violation_is_rejected_and_cancelled_proposals_cannot_publish() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, run, slides) = deck(&app, &f).await;
    let path = thread(&p, &run, &slides);
    f.model.invalid.store(true, Ordering::SeqCst);
    let (s, _) = request(
        &app.router(),
        "POST",
        &path,
        Some(edit_input(&run, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let failed = wait_edit(&app, &path, "failed").await;
    assert!(failed["proposal"].is_null());
    f.model.invalid.store(false, Ordering::SeqCst);
    let (s, v) = control(&app, &p, &failed, "retry", &Uuid::new_v4().to_string()).await;
    assert_eq!(s, 200, "{v}");
    let ready = wait_edit(&app, &path, "ready").await;
    let (s, v) = control(&app, &p, &ready, "reject", &Uuid::new_v4().to_string()).await;
    assert_eq!(s, 200);
    assert_eq!(v["status"], "rejected");
    f.model.hold.store(true, Ordering::SeqCst);
    request(
        &app.router(),
        "POST",
        &path,
        Some(edit_input(&run, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    let running = wait_edit(&app, &path, "running").await;
    let (s, cancelled) = control(&app, &p, &running, "cancel", &Uuid::new_v4().to_string()).await;
    assert_eq!(s, 200);
    assert_eq!(cancelled["status"], "cancelled");
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let (_, runs) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations"),
        None,
        None,
    )
    .await;
    assert_eq!(runs.as_array().unwrap().len(), 1);
    assert_eq!(runs[0]["presentation_version"], 1);
    let (s, _) = control(&app, &p, &cancelled, "apply", &Uuid::new_v4().to_string()).await;
    assert_eq!(s, 409);
    let (s, _) = request(
        &app.router(),
        "POST",
        &path.replace(&p, &Uuid::new_v4().to_string()),
        Some(edit_input(&run, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 404);
    app.shutdown().await.unwrap();
}
