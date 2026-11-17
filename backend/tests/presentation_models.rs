// Purpose: Verify server-selected writing models, immutable admission and legacy requests.
// Pattern: Real HTTP, SQLite and local renderer; settings changes never retarget accepted jobs.
// Usage: cargo nextest run --test presentation_models.
// Related: presentations/models.rs, presentation_scope.rs, presentation_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::{request, router};
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::*;
use serde_json::{Value, json};
use uuid::Uuid;

async fn configure(
    app: &Application,
    f: &Fixture,
    id: &str,
    version: i64,
    enabled: bool,
    kind: &str,
) -> Value {
    let (status, saved) = request(
        &router(app),
        "PUT",
        &format!("/api/v1/admin/llm/providers/{id}"),
        Some(
            json!({"expected_version":version,"name":"작성 연결","provider_type":kind,
        "base_url":f.base,"model_identifier":"fixture","timeout_seconds":30,"enabled":enabled}),
        ),
        None,
    )
    .await;
    assert_eq!(status, 200, "{saved}");
    saved
}
fn config(app_root: &std::path::Path, run: &Value) -> (String, String, i64) {
    let db = rusqlite::Connection::open(app_root.join("db/app.sqlite")).unwrap();
    db.query_row("SELECT c.connection_id,r.config_id,c.version FROM presentation_runs r JOIN llm_provider_config_versions c ON c.id=r.config_id WHERE r.id=?",
        [run["id"].as_str().unwrap()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_writing_is_pinned_and_never_uses_decision_connections() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, original, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &original).await;
    app.shutdown().await.unwrap();
    // Keep generation queued so changing Admin settings cannot race with the worker assertion.
    let mut app = Application::open(root.path()).unwrap();
    let decision = Uuid::nil().to_string();
    configure(&app, &f, &decision, 0, true, "lm_studio_decision").await;
    let other = Uuid::from_u128(u128::MAX).to_string();
    configure(&app, &f, &other, 0, true, "openai_compatible").await;
    configure(&app, &f, &original, 1, true, "openai_compatible").await;
    let mut input = input(&design, &original);
    input.as_object_mut().unwrap().remove("connection_id");
    input.as_object_mut().unwrap().remove("model_version");
    let path = format!("/api/v1/projects/{p}/presentations");
    let key = Uuid::new_v4().to_string();
    let (status, queued) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(status, 202, "{queued}");
    let pinned = config(root.path(), &queued);
    assert_eq!(pinned.0, original);
    assert_eq!(pinned.2, 2); // Updating a connection did not change its initial priority.
    configure(&app, &f, &original, 2, false, "openai_compatible").await;
    let (status, replay) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(status, 202);
    assert_eq!(replay["id"], queued["id"]);
    assert_eq!(config(root.path(), &replay), pinned);
    app.start_processing();
    let done = wait_run(&app, &p, "succeeded").await;
    assert_eq!(config(root.path(), &done), pinned);
    let mut revision = input.clone();
    revision["presentation_id"] = done["presentation_id"].clone();
    revision["expected_version"] = done["presentation_version"].clone();
    // Revisions retain the deck's connection and do not silently switch to another provider.
    let (status, error) = request(
        &router(&app),
        "POST",
        &path,
        Some(revision),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 422);
    assert!(error["message"].as_str().unwrap().contains("관리자"));
    let (status, next) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202, "{next}");
    assert_eq!(config(root.path(), &next).0, other);
    wait_run(&app, &p, "succeeded").await;
    configure(&app, &f, &other, 1, false, "openai_compatible").await;
    // A ready project can still have no writing model; Decision must not become its fallback.
    let (status, error) = request(
        &router(&app),
        "POST",
        &path,
        Some(input.clone()),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 422);
    assert!(error["message"].as_str().unwrap().contains("관리자"));
    configure(&app, &f, &original, 3, true, "openai_compatible").await;
    let mut legacy = input.clone();
    legacy["connection_id"] = json!(original);
    for version in [None, Some(0), Some(3)] {
        if let Some(v) = version {
            legacy["model_version"] = json!(v);
        } else {
            legacy.as_object_mut().unwrap().remove("model_version");
        }
        let (status, _) = request(
            &router(&app),
            "POST",
            &path,
            Some(legacy.clone()),
            Some(&Uuid::new_v4().to_string()),
        )
        .await;
        assert_eq!(status, if version == Some(3) { 409 } else { 422 });
    }
    legacy["model_version"] = json!(4);
    let (status, accepted) = request(
        &router(&app),
        "POST",
        &path,
        Some(legacy),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202, "{accepted}");
    wait_run(&app, &p, "succeeded").await;
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (status, replay) = request(&router(&app), "POST", &path, Some(input), Some(&key)).await;
    assert_eq!(status, 202);
    assert_eq!(replay["id"], queued["id"]);
    assert_eq!(config(root.path(), &replay), pinned);
}
