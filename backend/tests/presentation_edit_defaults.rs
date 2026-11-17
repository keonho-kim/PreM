// Purpose: Verify implicit editing uses the deck's LLM and preserves unspecified slide content.
// Pattern: Real server admission, pinned current config, immutable null-field proposals and restart.
// Usage: cargo nextest run --test presentation_edit_defaults.
// Related: presentations/edits/admission.rs, edit_model.rs, slide-chat.tsx.
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
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn implicit_model_follows_deck_connection_and_null_fields_keep_original_layout() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &format!("/api/v1/projects/{p}/presentations"),
            Some(input(&design, &c)),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        202
    );
    let original = wait_run(&app, &p, "succeeded").await;
    let before = slides(&app, &p, &original).await;
    let path = thread(&p, &original, &before);
    let config = |version, enabled| json!({"expected_version":version,"name":"작성 LLM","provider_type":"openai_compatible","base_url":f.base,"model_identifier":"fixture","timeout_seconds":30,"enabled":enabled});
    // An unrelated enabled LLM must never become an accidental fallback.
    assert_eq!(
        request(
            &common::router(&app),
            "PUT",
            &format!("/api/v1/admin/llm/providers/{}", Uuid::new_v4()),
            Some(config(0, true)),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &common::router(&app),
            "PUT",
            &format!("/api/v1/admin/llm/providers/{c}"),
            Some(config(1, true)),
            None
        )
        .await
        .0,
        200
    );
    let input = json!({"expected_version":1,"prompt":"title-only-auto","fields":["title","bullets","notes","objects","layout"]});
    let key = Uuid::new_v4().to_string();
    let (status, created) = request(
        &app.router(),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(status, 202, "{created}");
    assert_eq!(created["connection_id"], c);
    let ready = proposal(&app, &path, "ready").await;
    assert_eq!(ready["proposal"]["title"], "수정된 제목");
    for field in [
        "bullets",
        "notes",
        "objects",
        "layout",
        "schema_version",
        "block_ids",
    ] {
        assert_eq!(
            ready["proposal"][field], before[0]["spec"][field],
            "{field}"
        );
    }
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(db.query_row("SELECT c.version FROM presentation_edits e JOIN llm_provider_config_versions c ON c.id=e.config_id WHERE e.id=?",[ready["id"].as_str().unwrap()],|r|r.get::<_,i64>(0)).unwrap(),2);
    drop(db);
    assert_eq!(
        request(
            &common::router(&app),
            "PUT",
            &format!("/api/v1/admin/llm/providers/{c}"),
            Some(config(2, false)),
            None
        )
        .await
        .0,
        200
    );
    let (s, v) = request(
        &app.router(),
        "POST",
        &path,
        Some(input.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202);
    assert_eq!(v["id"], ready["id"]);
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &path,
            Some(input.clone()),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        422
    );
    let mut partial = input;
    partial["connection_id"] = json!(c);
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &path,
            Some(partial),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        422
    );
    command(&app, &p, &ready, "apply").await;
    let next = wait_run(&app, &p, "succeeded").await;
    assert_eq!(slides(&app, &p, &original).await, before);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        slides(&app, &p, &next).await[0]["spec"]["title"],
        "수정된 제목"
    );
    app.shutdown().await.unwrap();
}
