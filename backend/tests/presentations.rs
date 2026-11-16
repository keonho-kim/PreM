// Purpose: Verify real editable PPT production with immutable inputs and resumable checkpoints.
// Pattern: Local synthetic LLM, actual bundled renderer/Kordoc and disposable application storage.
// Usage: cargo nextest run --test presentations; no production data or live models.
// Related: outline_support/, V19 migration, modules/presentations/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use puputyx_backend::app::Application;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[allow(dead_code)]
mod presentation_support;
use presentation_support::*;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_output_preserves_lineage_replays_and_survives_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let payload = input(&design, &c);
    let key = Uuid::new_v4().to_string();
    let (s, run) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(payload.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{run}");
    let (s, replay) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(payload),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202);
    assert_eq!(replay["id"], run["id"]);
    let done = wait_run(&app, &p, "succeeded").await;
    assert_eq!(done["total"], 2);
    assert_eq!(done["completed"], 2);
    let id = done["id"].as_str().unwrap();
    let (s, slides) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations/{id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(slides.as_array().unwrap().len(), 2);
    assert_eq!(slides[0]["preview"], true);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let hash: String = db
        .query_row(
            "SELECT output_sha256 FROM presentation_revisions WHERE id=?",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    let path = root.path().join(format!(
        "blobs/sha256/{}/{}/{}",
        &hash[..2],
        &hash[2..4],
        hash
    ));
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    use std::io::Read;
    let mut xml = String::new();
    zip.by_name("ppt/slides/slide1.xml")
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    assert!(xml.contains("<a:t>"));
    assert!(
        !xml.contains("<p:pic>"),
        "Generated text must not be a screenshot"
    );
    let count: i64 = db
        .query_row(
            "SELECT count(*) FROM presentation_slide_evidence",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
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
    let calls = f.model.calls.load(Ordering::SeqCst);
    request(
        &app.router(),
        "PUT",
        &format!("/api/v1/projects/{p}/guide"),
        Some(json!({"expected_version":1,"do_text":"다른 방향","dont_text":""})),
        None,
    )
    .await;
    let stale = preparation(&app, &p).await;
    assert_eq!(stale["ready"], false);
    assert!(stale["design_id"].is_null());
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, runs) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations"),
        None,
        None,
    )
    .await;
    assert_eq!(runs[0]["status"], "succeeded");
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_generation_resumes_without_accepting_stale_commands() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    f.model.hold.store(true, Ordering::SeqCst);
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let r = wait_run(&app, &p, "running").await;
    let id = r["id"].as_str().unwrap();
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations/{id}/cancel"),
        Some(json!({"expected_version":r["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["status"], "cancelled");
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations/{id}/retry"),
        Some(json!({"expected_version":r["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 409);
    f.model.hold.store(false, Ordering::SeqCst);
    f.model.release.notify_waiters();
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations/{id}/retry"),
        Some(json!({"expected_version":v["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    wait_run(&app, &p, "succeeded").await;
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retry_reuses_completed_slide_and_keeps_exact_citations() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    f.model.fail_second.store(true, Ordering::SeqCst);
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202);
    let failed = wait_run(&app, &p, "failed").await;
    assert_eq!(failed["completed"], 1);
    let id = failed["id"].as_str().unwrap();
    let (_, before) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations/{id}/slides"),
        None,
        None,
    )
    .await;
    app.shutdown().await.unwrap();
    f.model.fail_second.store(false, Ordering::SeqCst);
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations/{id}/retry"),
        Some(json!({"expected_version":failed["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    wait_run(&app, &p, "succeeded").await;
    assert_eq!(f.model.slides.load(Ordering::SeqCst), 3);
    let (_, after) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations/{id}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(before[0]["spec"], after[0]["spec"]);
    let slide = after[0]["id"].as_str().unwrap();
    let (s, evidence) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentations/{id}/slides/{slide}/evidence"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{evidence}");
    assert_eq!(evidence[0]["block_id"], after[0]["spec"]["block_ids"][0]);
    assert!(evidence[0]["job_id"].is_string());
    assert_eq!(evidence[0]["available"], true);
    app.shutdown().await.unwrap();
}
