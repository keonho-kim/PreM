// Purpose: Verify batched native relation search, provenance, cache identity and pinned selections.
// Pattern: Real uploads/SQLite and a deterministic local model; no original body duplication.
// Usage: cargo nextest run --test related_documents.
// Related: relation_support/, modules/relations/, V1__baseline.sql.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod relation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use prem_backend::app::Application;
use relation_support::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_pairs_are_parallel_cached_and_group_project_origins() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let provider = register(&app, &f).await;
    let target = setup(&app, 16).await;
    let duplicate = project(&app, "동일 문서 사용 프로젝트").await;
    let item = upload(
        &app,
        &duplicate,
        "efficiency SUPPORT evidence for workflow optimization number 0",
    )
    .await;
    prepared(&app, &duplicate, &item).await;
    let different = project(&app, "다른 표현의 업무 사례").await;
    let item = upload(
        &app,
        &different,
        "DIVERSE_ONLY process redesign and work simplification case study",
    )
    .await;
    prepared(&app, &different, &item).await;

    let(s,v)=request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{provider}/capacity"),Some(json!({"expected_version":0,"max_parallel":2,"queue_capacity":8,"queue_timeout_seconds":30})),None).await;
    assert_eq!(s, 200, "{v}");
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    let done = wait(&app, &target, id, "succeeded").await;
    assert!(done["total"].as_i64().unwrap() >= 24);
    assert_eq!(done["completed"], done["total"]);
    assert!(f.model.peak.load(Ordering::SeqCst) >= 2);
    assert!(f.model.peak.load(Ordering::SeqCst) <= 2);
    assert_eq!(
        f.model.calls.load(Ordering::SeqCst),
        done["total"].as_u64().unwrap() as usize
    );
    assert!(
        f.model
            .question_counts
            .lock()
            .unwrap()
            .iter()
            .all(|n| *n == 1)
    );
    assert!(f.model.sizes.lock().unwrap().iter().all(|n| *n < 32 * 1024));
    let files = results(&app, &target, id, "file").await;
    let mut all = files["items"].as_array().unwrap().clone();
    let (_, next) = request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/projects/{target}/related-searches/{id}/results?kind=file&offset=12"),
        None,
        None,
    )
    .await;
    all.extend(next["items"].as_array().unwrap().clone());
    assert!(
        all.iter().any(|v| v["relation"] == 3),
        "diverse non-keyword file must reach the model"
    );
    let grouped = all
        .iter()
        .find(|v| v["origin_count"].as_i64().unwrap() > 1)
        .expect("same extraction grouped across projects");
    assert!(
        grouped["origins"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["project_id"] != target)
    );
    let selected = json!({"candidate_id":grouped["id"],"source_version_id":grouped["origins"][0]["source_version_id"],"expected_version":0,"selected":true});
    let (s, link) = request(
        &crate::common::router(&app),
        "PUT",
        &format!("/api/v1/projects/{target}/related-items"),
        Some(selected.clone()),
        None,
    )
    .await;
    assert_eq!(s, 200, "{link}");
    assert_eq!(
        request(
            &crate::common::router(&app),
            "PUT",
            &format!("/api/v1/projects/{target}/related-items"),
            Some(selected),
            None
        )
        .await
        .1,
        link
    );
    assert_eq!(
        request(
            &crate::common::router(&app),
            "GET",
            &format!("/api/v1/projects/{duplicate}/related-searches/{id}"),
            None,
            None
        )
        .await
        .0,
        404
    );
    let calls = f.model.calls.load(Ordering::SeqCst);
    let repeat = start(&app, &target, "efficiency").await;
    let repeated = wait(&app, &target, repeat["id"].as_str().unwrap(), "succeeded").await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(repeated["cache_hits"], repeated["total"]);
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (s, chosen) = request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/projects/{target}/related-items"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(chosen["total"], 1);
    assert_eq!(chosen["items"][0]["origins"][0], grouped["origins"][0]);
    let (_, g) = request(
        &crate::common::router(&app),
        "PUT",
        &format!("/api/v1/projects/{target}/guide"),
        Some(json!({"expected_version":0,"do_text":"Different business direction","dont_text":""})),
        None,
    )
    .await;
    assert_eq!(g["version"], 1);
    let (_, old) = request(
        &crate::common::router(&app),
        "GET",
        &format!("/api/v1/projects/{target}/related-searches/{id}"),
        None,
        None,
    )
    .await;
    assert_eq!(old["stale"], true);
    let another = start(&app, &target, "efficiency").await;
    wait(&app, &target, another["id"].as_str().unwrap(), "succeeded").await;
    assert!(f.model.calls.load(Ordering::SeqCst) > calls);
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM relation_link_changes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(db.query_row("SELECT count(*) FROM relation_assessments a JOIN llm_requests r ON r.id=a.request_id WHERE r.status!='succeeded'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn search_admission_and_retry_preserve_completed_decisions() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    register(&app, &f).await;
    let target = setup(&app, 12).await;
    let (status, _) = request(
        &common::router(&app),
        "PUT",
        "/api/v1/admin/document-processing/settings",
        Some(json!({"expected_version":1,"connection_id":null})),
        None,
    )
    .await;
    assert_eq!(status, 200);
    let (status, error) = request(
        &common::router(&app),
        "POST",
        &format!("/api/v1/projects/{target}/related-searches"),
        Some(json!({"query":"efficiency","options":{}})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 422, "{error}");
    assert_eq!(error["code"], "decision_model_required");
    let (_, providers) = request(
        &common::router(&app),
        "GET",
        "/api/v1/admin/llm/providers",
        None,
        None,
    )
    .await;
    let (status, _) = request(
        &common::router(&app),
        "PUT",
        "/api/v1/admin/document-processing/settings",
        Some(json!({"expected_version":2,"connection_id":providers[0]["id"]})),
        None,
    )
    .await;
    assert_eq!(status, 200);
    f.model.fail_once.store(true, Ordering::SeqCst);
    let waiting = start(&app, &target, "efficiency").await;
    let failed = wait(&app, &target, waiting["id"].as_str().unwrap(), "failed").await;
    assert!(failed["completed"].as_i64().unwrap() > 0);
    assert!(failed["completed"] != failed["total"]);
    let calls = f.model.calls.load(Ordering::SeqCst);
    let key = Uuid::new_v4().to_string();
    let (s, r) = request(
        &crate::common::router(&app),
        "POST",
        &format!(
            "/api/v1/projects/{target}/related-searches/{}/retry",
            waiting["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":failed["version"]})),
        Some(&key),
    )
    .await;
    assert_eq!(s, 200, "{r}");
    let done = wait(&app, &target, waiting["id"].as_str().unwrap(), "succeeded").await;
    assert_eq!(done["completed"], done["total"]);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls + 1);
    app.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn structured_llm_bridge_batches_multiple_candidates_and_reuses_them() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    register_kind(&app, &f, "lm_studio").await;
    let target = setup(&app, 12).await;

    let run = start(&app, &target, "efficiency").await;
    let done = wait(&app, &target, run["id"].as_str().unwrap(), "succeeded").await;
    assert!(f.model.calls.load(Ordering::SeqCst) < done["total"].as_u64().unwrap() as usize);
    assert!(
        f.model
            .question_counts
            .lock()
            .unwrap()
            .iter()
            .any(|n| *n > 1)
    );
    assert!(
        f.model
            .question_counts
            .lock()
            .unwrap()
            .iter()
            .all(|n| *n <= 8)
    );
    let calls = f.model.calls.load(Ordering::SeqCst);
    let repeat = start(&app, &target, "efficiency").await;
    wait(&app, &target, repeat["id"].as_str().unwrap(), "succeeded").await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    app.shutdown().await.unwrap();
}
