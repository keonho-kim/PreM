// Purpose: Verify one CAS selection governs document processing and relation search.
// Pattern: Real HTTP and SQLite with isolated storage and no external model calls.
// Usage: cargo test --test shared_decision_settings.
// Related: V33 migration, sqlite/decision_settings.rs.
mod common;
use common::request;
use prem_backend::app::Application;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn shared_selection_conflicts_and_survives_restart() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let id = Uuid::new_v4();
    let (s, _) = request(&common::router(&app), "PUT", &format!("/api/v1/admin/llm/providers/{id}"), Some(json!({"expected_version":0,"name":"Shared decision","provider_type":"lm_studio","base_url":"http://127.0.0.1:1234/v1","model_identifier":"fixture","timeout_seconds":30,"enabled":true})), None).await;
    assert_eq!(s, 200);
    let documents = "/api/v1/admin/document-processing/settings";
    let relations = "/api/v1/admin/related-search/settings";
    let (s, saved) = request(
        &common::router(&app),
        "PUT",
        documents,
        Some(json!({"expected_version":0,"connection_id":id})),
        None,
    )
    .await;
    assert_eq!(s, 200, "{saved}");
    let (s, related) = request(&common::router(&app), "GET", relations, None, None).await;
    assert_eq!(s, 200, "{related}");
    assert_eq!(related["connection_id"], id.to_string());
    assert_eq!(related["version"], saved["version"]);
    let (s, _) = request(
        &common::router(&app),
        "PUT",
        relations,
        Some(json!({"expected_version":0,"connection_id":null,"planner_connection_id":null})),
        None,
    )
    .await;
    assert_eq!(s, 409);
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, restored) = request(&common::router(&app), "GET", documents, None, None).await;
    assert_eq!(restored, saved);
    app.shutdown().await.unwrap();
}

#[tokio::test]
async fn public_setup_checks_enabled_writing_and_the_selected_decision_capability() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let admin = common::router(&app);
    let public = app.router();
    let status = async |llm, decision| {
        let (code, body) = request(&public, "GET", "/api/v1/models/setup", None, None).await;
        assert_eq!(code, 200);
        assert_eq!(body, json!({"llm":llm, "decision":decision}));
    };
    let save = async |id: Uuid, kind: &str, version: i64, enabled: bool| {
        let (code, body) = request(&admin,"PUT",&format!("/api/v1/admin/llm/providers/{id}"),
            Some(json!({"expected_version":version,"name":"Setup test","provider_type":kind,
            "base_url":"http://127.0.0.1:1/v1","model_identifier":"fixture","timeout_seconds":5,"enabled":enabled})),None).await;
        assert_eq!(code, 200, "{body}");
    };
    let select = async |version: i64, id: Uuid| {
        let (code, body) = request(
            &admin,
            "PUT",
            "/api/v1/admin/document-processing/settings",
            Some(json!({"expected_version":version,"connection_id":id})),
            None,
        )
        .await;
        assert_eq!(code, 200, "{body}");
    };
    let decision = Uuid::new_v4();
    let writer = Uuid::new_v4();
    status(false, false).await;
    save(decision, "lm_studio_decision", 0, true).await;
    status(false, false).await;
    select(0, decision).await;
    status(false, true).await;
    save(writer, "openai_compatible", 0, true).await;
    status(true, true).await;
    save(decision, "lm_studio_decision", 1, false).await;
    status(true, false).await;
    select(1, writer).await;
    status(true, true).await;
    save(writer, "openai_compatible", 1, false).await;
    status(false, false).await;
    app.shutdown().await.unwrap();
}
