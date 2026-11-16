// Purpose: Verify the authoritative catalog matches accepted stored identities and restart recovery.
// Pattern: Real HTTP and SQLite with isolated application-owned QA data.
// Usage: cargo nextest run --test provider_catalog.
// Related: model_registry/kind.rs, sqlite/libraries/uploads.rs, sqlite/model_requests.rs.
mod common;
use common::request;
use puputyx_backend::app::Application;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn every_catalog_kind_is_accepted_and_unknown_kinds_are_rejected() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = crate::common::router(&app);
    let (status, catalog) = request(
        &router,
        "GET",
        "/api/v1/admin/llm/provider-types",
        None,
        None,
    )
    .await;
    assert_eq!(status, 200);
    let entries = catalog.as_array().unwrap();
    assert_eq!(entries.len(), 19);
    let ids = entries
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), entries.len());
    for entry in entries {
        let path = format!("/api/v1/admin/llm/providers/{}", Uuid::new_v4());
        let input = json!({"expected_version":0,"name":entry["label"],"provider_type":entry["id"],"base_url":entry["base"],"model_identifier":"fixture","timeout_seconds":5,"enabled":true});
        let (s, p) = request(&router, "PUT", &path, Some(input), None).await;
        assert_eq!(s, 200, "{p}");
        assert_eq!(p["provider_type"], entry["id"]);
    }
    let unknown = json!({"expected_version":0,"name":"Unsupported","provider_type":"future-unknown","base_url":"http://localhost/","model_identifier":"fixture","timeout_seconds":5,"enabled":true});
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/api/v1/admin/llm/providers/{}", Uuid::new_v4()),
            Some(unknown),
            None
        )
        .await
        .0,
        400
    );
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn startup_owners_only_transition_unfinished_uploads_and_requests() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let (_,p)=request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{}",Uuid::new_v4()),Some(json!({"expected_version":0,"name":"Fixture","provider_type":"openai_compatible","base_url":"http://localhost/","model_identifier":"fixture","timeout_seconds":5,"enabled":true})),None).await;
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    for state in ["receiving", "failed", "cancelled"] {
        db.execute(
            "INSERT INTO upload_requests(request_key,state,created_at) VALUES (?,?,1)",
            [state, state],
        )
        .unwrap();
    }
    for status in ["running", "succeeded", "failed"] {
        db.execute("INSERT INTO llm_requests(id,provider_config_version_id,kind,status,created_at) VALUES (?,?,'text',?,1)",rusqlite::params![Uuid::new_v4().to_string(),p["config_id"].as_str().unwrap(),status]).unwrap();
    }
    drop(db);
    let reopened = Application::open(root.path()).unwrap();
    reopened.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let uploads = db
        .prepare("SELECT request_key,state FROM upload_requests ORDER BY request_key")
        .unwrap()
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        uploads,
        vec![
            ("cancelled".into(), "cancelled".into()),
            ("failed".into(), "failed".into()),
            ("receiving".into(), "failed".into())
        ]
    );
    let statuses = db
        .prepare("SELECT status FROM llm_requests ORDER BY status")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(statuses, vec!["failed", "interrupted", "succeeded"]);
    assert_eq!(
        db.query_row(
            "SELECT error_code FROM llm_requests WHERE status='interrupted'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "server_restarted"
    );
}
