// Purpose: Verify past-document filters, deletion visibility and retained source selections.
// Pattern: Real project originals and native decisions with immutable provenance after source removal.
// Usage: cargo nextest run --test related_scope.
// Related: relation_support/, relations/retrieval.rs, relations/selections.rs.
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
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn search_options(app: &Application, p: &str, options: Value) -> Value {
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/related-searches"),
        Some(json!({"query":"efficiency","options":options})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    v
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scope_filters_do_not_call_models_and_deleted_sources_keep_only_retained_links() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let target = setup(&app, 0).await;
    let past = project(&app, "과거 업무").await;
    let item = upload(
        &app,
        &past,
        "efficiency SUPPORT prior customer service improvements",
    )
    .await;
    prepared(&app, &past, &item).await;
    register(&app, &f).await;
    let (s, _) = request(
        &app.router(),
        "PATCH",
        &format!("/api/v1/projects/{past}"),
        Some(json!({"expected_version":1,"status":"archived"})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    for filters in [
        json!({}),
        json!({"include_archived":true,"format":"pdf"}),
        json!({"include_archived":true,"source_project":Uuid::new_v4()}),
        json!({"include_archived":true,"since":item["created_at"].as_i64().unwrap()+1}),
    ] {
        let run = search_options(&app, &target, filters).await;
        assert_eq!(run["total"], 0);
        assert_eq!(run["status"], "succeeded");
    }
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    let run = search_options(
        &app,
        &target,
        json!({"include_archived":true,"format":"html","source_project":past}),
    )
    .await;
    let id = run["id"].as_str().unwrap();
    wait(&app, &target, id, "succeeded").await;
    let files = results(&app, &target, id, "file").await;
    assert_eq!(files["total"], 1);
    let row = &files["items"][0];
    let selected = json!({"candidate_id":row["id"],"source_version_id":row["origins"][0]["source_version_id"],"expected_version":0,"selected":true});
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &format!("/api/v1/projects/{target}/related-items"),
            Some(selected),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &app.router(),
            "DELETE",
            &format!("/api/v1/projects/{past}"),
            Some(json!({"expected_version":2})),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(results(&app, &target, id, "file").await["total"], 0);
    let (_, retained) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{target}/related-items"),
        None,
        None,
    )
    .await;
    assert_eq!(retained["total"], 1);
    assert_eq!(retained["items"][0]["origins"][0]["available"], false);
    let remove = json!({"candidate_id":row["id"],"source_version_id":row["origins"][0]["source_version_id"],"expected_version":1,"selected":false});
    let (s, v) = request(
        &app.router(),
        "PUT",
        &format!("/api/v1/projects/{target}/related-items"),
        Some(remove.clone()),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(v["version"], 2);
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &format!("/api/v1/projects/{target}/related-items"),
            Some(remove),
            None
        )
        .await
        .1,
        v
    );
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM relation_link_changes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}
