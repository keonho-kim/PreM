// Purpose: Prove batch failure/retry never partially publishes or repeats completed model work.
// Pattern: Real durable proposals across restart, foreign-target rejection and conditional apply.
// Usage: cargo nextest run --test presentation_batches.
// Related: presentation_support/edits.rs, V21 migration, slide_edits.rs.
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
use presentation_support::{edits::*, *};
use serde_json::json;
use std::sync::atomic::Ordering;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_batch_retains_checkpoints_and_retries_only_missing_slide_after_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let original = wait_run(&app, &p, "succeeded").await;
    let before = slides(&app, &p, &original).await;
    let path = thread(&p, &original, &before);
    let mut req = json!({"expected_version":1,"connection_id":c,"model_version":1,"prompt":"batch-failure","fields":["title"],"slide_ids":[before[0]["id"],Uuid::new_v4()]});
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &path,
            Some(req.clone()),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        404
    );
    req["slide_ids"] = json!([before[0]["id"], before[1]["id"]]);
    f.model.fail_second.store(true, Ordering::SeqCst);
    let (s, v) = request(
        &app.router(),
        "POST",
        &path,
        Some(req),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let failed = proposal(&app, &path, "failed").await;
    assert_eq!(failed["targets"][0]["completed"], true);
    assert_eq!(failed["targets"][1]["completed"], false);
    assert_eq!(slides(&app, &p, &original).await, before);
    assert_eq!(
        request(
            &app.router(),
            "GET",
            &format!("/api/v1/projects/{p}/presentations"),
            None,
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        1
    );
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    f.model.fail_second.store(false, Ordering::SeqCst);
    let calls = f.model.calls.load(Ordering::SeqCst);
    command(&app, &p, &failed, "retry").await;
    let ready = proposal(&app, &path, "ready").await;
    assert_eq!(f.model.calls.load(Ordering::SeqCst) - calls, 1);
    command(&app, &p, &ready, "apply").await;
    let next = wait_run(&app, &p, "succeeded").await;
    assert_eq!(next["presentation_version"], 2);
    assert_eq!(slides(&app, &p, &original).await, before);
    let after = slides(&app, &p, &next).await;
    for i in 0..2 {
        assert_eq!(after[i]["spec"]["title"], "수정된 제목");
        assert_eq!(after[i]["spec"]["bullets"], before[i]["spec"]["bullets"]);
    }
    app.shutdown().await.unwrap();
}
