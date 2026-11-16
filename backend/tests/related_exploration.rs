// Purpose: Verify dynamic evidence reads, bounded pulls and pinned optional planning end to end.
// Pattern: Real document processing and durable SQLite; deterministic local model contracts.
// Usage: cargo nextest run --test related_exploration; no application storage or model downloads.
// Related: relation_support/, V18__relation_workspaces.sql, modules/relations/.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod relation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use puputyx_backend::app::Application;
use relation_support::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ambiguous_excerpt_reads_neighbors_and_retains_original_assessment() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let target = setup(&app, 1).await;
    let old = project(&app, "문맥이 필요한 원본").await;
    let text = format!(
        "intro</p><p>section</p><p>heading</p><p>background</p><p>overview</p><p>efficiency NEEDS_CONTEXT costs {}</p><p>BASELINE_CONFIRMED measured in 2025 on equal units",
        "detail ".repeat(160)
    );
    let item = upload(&app, &old, &text).await;
    prepared(&app, &old, &item).await;
    register(&app, &f).await;
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    let done = wait(&app, &target, id, "succeeded").await;
    assert_eq!(done["exploration"]["round"], 1);
    assert_eq!(done["exploration"]["stop_reason"], "reviewed");
    assert!(f.model.peer_calls.load(Ordering::SeqCst) > 0);
    let rows = results(&app, &target, id, "block").await;
    let candidate = rows["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["excerpt"].as_str().unwrap().contains("NEEDS_CONTEXT"))
        .unwrap();
    assert_eq!(candidate["relation"], 2);
    let url = format!(
        "/api/v1/projects/{target}/related-candidates/{}/evidence",
        candidate["id"].as_str().unwrap()
    );
    let (status, evidence) = request(&crate::common::router(&app), "GET", &url, None, None).await;
    assert_eq!(status, 200);
    assert!(
        evidence
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["text"].as_str().unwrap().contains("BASELINE_CONFIRMED"))
    );
    assert!(
        evidence
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["comparison"] == true)
    );
    let calls = f.model.calls.load(Ordering::SeqCst);
    let again = start(&app, &target, "efficiency").await;
    wait(&app, &target, again["id"].as_str().unwrap(), "succeeded").await;
    assert_eq!(
        f.model.calls.load(Ordering::SeqCst),
        calls,
        "all committed evidence assessments are reused"
    );
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert!(db.query_row("SELECT count(*) FROM relation_review_history h JOIN relation_assessments a ON a.cache_key=h.assessment_key WHERE a.relation=5",[],|r|r.get::<_,i64>(0)).unwrap()>0);
    assert_eq!(db.query_row("SELECT count(*) FROM relation_reads r JOIN relation_candidates c ON c.id=r.candidate_id JOIN content_blocks b ON b.id=r.block_id JOIN document_pages p ON p.id=b.page_id WHERE c.extraction_id!=p.extraction_id",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(db.query_row("SELECT count(*) FROM relation_reads a JOIN relation_reads b ON a.candidate_id=b.candidate_id AND a.block_id=b.block_id JOIN relation_candidates c ON c.id=a.candidate_id WHERE a.round=0 AND b.round=1 AND a.block_id=c.excerpt_block_id AND b.byte_length<a.byte_length",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    drop(db);
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        request(&crate::common::router(&app), "GET", &url, None, None)
            .await
            .1,
        evidence
    );
    app.shutdown().await.unwrap();
}
async fn planning(app: &Application, f: &Fixture) -> String {
    let id = Uuid::new_v4().to_string();
    let (s,v)=request(&crate::common::router(app),"PUT",&format!("/api/v1/admin/llm/providers/{id}"),Some(json!({"expected_version":0,"name":"검색 계획","provider_type":"lm_studio","base_url":f.base,"model_identifier":"planner","timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200, "{v}");
    id
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn query_planner_pulls_missing_document_and_invalid_output_preserves_checkpoint() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let target = setup(&app, 0).await;
    let past = project(&app, "후속 자료").await;
    let bridge = upload(&app, &past, "BRIDGE_TOKEN exact baseline report").await;
    prepared(&app, &past, &bridge).await;
    let fill = upload(&app, &past, "unrelated generic filler").await;
    prepared(&app, &past, &fill).await;
    let uncertain = upload(&app, &past, "efficiency NEEDS_MORE lacking original report").await;
    prepared(&app, &past, &uncertain).await;
    let decision = register(&app, &f).await;
    let planner = planning(&app, &f).await;
    let (s, v) = request(
        &crate::common::router(&app),
        "PUT",
        "/api/v1/admin/related-search/settings",
        Some(
            json!({"expected_version":1,"connection_id":decision,"planner_connection_id":planner}),
        ),
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    f.model.invalid_planner.store(true, Ordering::SeqCst);
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    let failed = wait(&app, &target, id, "failed").await;
    assert_eq!(failed["exploration"]["phase"], "discover");
    assert_eq!(failed["completed"], failed["total"]);
    let before = f.model.calls.load(Ordering::SeqCst);
    let (s, v) = request(
        &crate::common::router(&app),
        "POST",
        &format!("/api/v1/projects/{target}/related-searches/{id}/retry"),
        Some(json!({"expected_version":failed["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    let done = wait(&app, &target, id, "succeeded").await;
    assert_eq!(done["exploration"]["round"], 2);
    assert_eq!(done["exploration"]["added_candidates"], 2);
    assert_eq!(f.model.planner_calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        f.model.calls.load(Ordering::SeqCst),
        before + 3,
        "retry only planner and two new candidates"
    );
    let rows = results(&app, &target, id, "file").await;
    assert!(
        rows["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["origins"][0]["item_id"] == bridge["id"])
    );
    assert!(
        done["exploration"]["unresolved"].as_i64().unwrap() > 0,
        "missing evidence stays unknown"
    );
    assert_eq!(done["exploration"]["stop_reason"], "needs_review");
    let foreign = project(&app, "다른 대상").await;
    let c = rows["items"][0]["id"].as_str().unwrap();
    assert_eq!(
        request(
            &crate::common::router(&app),
            "GET",
            &format!("/api/v1/projects/{foreign}/related-candidates/{c}/evidence"),
            None,
            None
        )
        .await
        .0,
        404
    );
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM relation_pulls WHERE query='BRIDGE_TOKEN'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn expired_workspace_stops_without_spending_more_model_calls() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let target = setup(&app, 1).await;
    let run = start(&app, &target, "efficiency").await;
    let id = run["id"].as_str().unwrap();
    assert_eq!(run["status"], "waiting_configuration");
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute(
        "UPDATE relation_workspaces SET deadline_at=1 WHERE run_id=?",
        [id],
    )
    .unwrap();
    drop(db);
    register(&app, &f).await;
    let done = wait(&app, &target, id, "succeeded").await;
    assert_eq!(done["exploration"]["stop_reason"], "budget");
    assert_eq!(done["completed"], 0);
    assert!(done["total"].as_i64().unwrap() > 0);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    assert!(
        results(&app, &target, id, "file").await["total"]
            .as_i64()
            .unwrap()
            > 0
    );
    app.shutdown().await.unwrap();
}
