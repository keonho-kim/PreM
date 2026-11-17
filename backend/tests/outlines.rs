// Purpose: Verify generated/manual outlines, source mappings and immutable confirmation semantics.
// Pattern: Real app/SQLite and synthetic native execution contract.
// Usage: cargo nextest run --test outlines.
// Related: outline_support/, outline_recovery.rs, V17 migration.
mod common;
mod outline_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn generated_outlines_manual_edits_mapping_and_confirmation_are_shared_and_versioned() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    create(&app, &p, &c, "generate").await;
    let s = wait(&app, &p, "succeeded").await;
    assert_eq!(s["version"], 1);
    assert_eq!(s["draft"]["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(s["draft"]["assignments"].as_array().unwrap().len(), 2);
    let old = s["revision_id"].clone();
    let mut draft = s["draft"].clone();
    draft["nodes"][1]["title"] = json!("현황과 과제");
    let (sv, saved) = request(
        &app.router(),
        "PUT",
        &format!("/api/v1/projects/{p}/outline"),
        Some(edit(&s, draft.clone())),
        None,
    )
    .await;
    assert_eq!(sv, 200, "{saved}");
    assert_eq!(saved["version"], 2);
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &format!("/api/v1/projects/{p}/outline"),
            Some(edit(&s, draft.clone())),
            None
        )
        .await
        .0,
        409
    );
    let (_, history) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/outline/revisions/{}",
            old.as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(history["draft"]["nodes"][1]["title"], "현황 요약");
    draft["assignments"] = json!([]);
    let (_, unmapped) = request(
        &app.router(),
        "PUT",
        &format!("/api/v1/projects/{p}/outline"),
        Some(edit(&saved, draft)),
        None,
    )
    .await;
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &format!("/api/v1/projects/{p}/outline/confirm"),
            Some(json!({"expected_version":unmapped["version"]})),
            None
        )
        .await
        .0,
        422
    );
    create(&app, &p, &c, "map").await;
    let mapped = wait(&app, &p, "succeeded").await;
    assert_eq!(mapped["version"], 4);
    assert!(mapped["draft"]["assignments"].as_array().unwrap().len() > 22);
    let (status, confirmed) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/outline/confirm"),
        Some(json!({"expected_version":4})),
        None,
    )
    .await;
    assert_eq!(status, 200, "{confirmed}");
    assert_eq!(confirmed["confirmed"], true);
    let b = confirmed["draft"]["assignments"][0]["block_id"]
        .as_str()
        .unwrap();
    let (status, blocks) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/outline/blocks?ids={b}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(blocks["items"].as_array().unwrap().len(), 1);
    assert!(blocks["items"][0]["job_id"].is_string());
    let calls = f.model.calls.load(Ordering::SeqCst);
    request(
        &app.router(),
        "PUT",
        &format!("/api/v1/projects/{p}/guide"),
        Some(json!({"expected_version":1,"do_text":"다른 방향","dont_text":""})),
        None,
    )
    .await;
    let changed = state(&app, &p).await;
    assert_eq!(changed["stale"], true);
    assert_eq!(changed["confirmed"], false);
    assert_eq!(changed["version"], 4);
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM outline_nodes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM outline_node_versions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        4
    );
    drop(db);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(state(&app, &p).await["draft"], mapped["draft"]);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn foreign_blocks_invalid_hierarchies_and_unknown_model_aliases_never_commit() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let s = state(&app, &p).await;
    let id = Uuid::new_v4();
    let invalid = json!({"nodes":[{"id":id,"parent_id":id,"title":"cycle","description":""}],"assignments":[]});
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &format!("/api/v1/projects/{p}/outline"),
            Some(edit(&s, invalid)),
            None
        )
        .await
        .0,
        422
    );
    let invalid = json!({"nodes":[{"id":id,"parent_id":null,"title":"valid","description":""}],"assignments":[{"node_id":id,"block_id":Uuid::new_v4()}]});
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &format!("/api/v1/projects/{p}/outline"),
            Some(edit(&s, invalid)),
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(state(&app, &p).await["version"], 0);
    f.model.invalid.store(true, Ordering::SeqCst);
    create(&app, &p, &c, "generate").await;
    let failed = wait(&app, &p, "failed").await;
    assert_eq!(failed["version"], 0);
    assert_eq!(failed["run"]["completed"], 0);
    app.shutdown().await.unwrap();
}
