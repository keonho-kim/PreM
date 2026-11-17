// Purpose: Verify unified Space discovery, canonical excerpts and exclusion of project originals.
// Pattern: Real uploaded documents and SQLite/HTTP; synthetic local model configuration, without live provider calls.
// Usage: cargo nextest run --test library_search.
// Related: modules/search/, adapters/sqlite/search.rs, document_support/.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use document_support::{fixture, upload, wait};
use prem_backend::app::Application;
use serde_json::{Value, json};
use uuid::Uuid;
async fn search(app: &Application, q: &str, extra: &str) -> Value {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("q", q)
        .finish();
    let (status, result) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/search?{query}{extra}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{result}");
    result
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn space_search_combines_names_and_content_but_never_includes_project_originals() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let reference = upload(
        &app,
        "references",
        "운영 보고.md",
        "# 보고서\n\n분기 실적 검토 결과를 공유합니다.\n\n<script>noExecution()</script>"
            .as_bytes(),
    )
    .await;
    let id = reference["id"].as_str().unwrap();
    let detail = wait(&app, "references", id, "succeeded").await;
    let template = upload(
        &app,
        "templates",
        "분기 발표.pptx",
        &fixture("native-template.pptx"),
    )
    .await;
    wait(
        &app,
        "templates",
        template["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    // Same extracted bytes also belong to a project; only the Space registration is searchable.
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let model_requests: i64 = db
        .query_row("SELECT count(*) FROM llm_requests", [], |r| r.get(0))
        .unwrap();
    let project = Uuid::new_v4().to_string();
    let source = Uuid::new_v4().to_string();
    let version = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,'Project only',1,1)",
        [&project],
    )
    .unwrap();
    db.execute("INSERT INTO source_items(id,project_id,title,created_at,updated_at) VALUES (?,?,'비공개 프로젝트 원본',1,1)",[&source,&project]).unwrap();
    db.execute("INSERT INTO source_versions SELECT ?,?,1,file_registration_id,1 FROM reference_versions WHERE item_id=?",[&version,&source,id]).unwrap();
    db.execute(
        "UPDATE source_items SET current_version_id=? WHERE id=?",
        [&version, &source],
    )
    .unwrap();
    db.execute("UPDATE document_jobs SET status='succeeded',profile='fixture',extraction_id=? WHERE source_version_id=?",[detail["job"]["extraction_id"].as_str().unwrap(),&version]).unwrap();
    let all = search(&app, "분기", "").await;
    assert_eq!(all["total"], 2);
    assert!(
        all["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["kind"] == "references" || i["kind"] == "templates")
    );
    let content = search(&app, "실적", "&mode=content").await;
    assert_eq!(content["total"], 1);
    assert_eq!(content["items"][0]["job_id"], detail["job"]["id"]);
    assert!(content["items"][0]["page_id"].is_string());
    assert!(
        content["items"][0]["excerpt"]
            .as_str()
            .unwrap()
            .contains("실적")
    );
    assert_eq!(content["items"][0]["name_match"], false);
    assert_eq!(search(&app, "실적", "&mode=files").await["total"], 0);
    let templates = search(&app, "분기", "&scope=templates").await;
    assert_eq!(templates["total"], 1);
    assert!(templates["items"][0]["preview"].is_string());
    assert_eq!(search(&app, "비공개", "").await["total"], 0);
    assert_eq!(search(&app, "\" OR * --", "").await["total"], 0);
    assert_eq!(search(&app, "", "").await["total"], 0);
    assert_eq!(
        request(
            &app.router(),
            "GET",
            "/api/v1/search?q=x&scope=projects",
            None,
            None
        )
        .await
        .0,
        422
    );
    let (status, _) = request(
        &app.router(),
        "PATCH",
        &format!("/api/v1/space/references/{id}"),
        Some(json!({"expected_version":1,"status":"archived"})),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(search(&app, "실적", "").await["total"], 0);
    assert_eq!(search(&app, "실적", "&archived=true").await["total"], 1);
    assert_eq!(
        db.query_row("SELECT count(*) FROM llm_requests", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        model_requests
    );
    drop(db);
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_search_paginates_and_uses_only_the_current_file_version() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    for i in 0..13 {
        upload(
            &app,
            "references",
            &format!("공통 자료 {i}.md"),
            format!("# 문서 {i}\n\n이전표현").as_bytes(),
        )
        .await;
    }
    let first = search(&app, "공통", "").await;
    let second = search(&app, "공통", "&offset=12").await;
    assert_eq!(first["total"], 13);
    assert_eq!(first["items"].as_array().unwrap().len(), 12);
    assert_eq!(second["items"].as_array().unwrap().len(), 1);
    let id = first["items"][0]["id"].as_str().unwrap();
    wait(&app, "references", id, "succeeded").await;
    let (status, _) = space_support::upload(
        &app.router(),
        &format!("/api/v1/space/references/{id}/versions"),
        &Uuid::new_v4().to_string(),
        Some(1),
        "새 문서.md",
        b"# Replacement\n\nnew_unique_phrase",
        "updated",
    )
    .await;
    assert_eq!(status, 201);
    wait(&app, "references", id, "succeeded").await;
    let result = search(&app, "new_unique_phrase", "").await;
    assert_eq!(result["total"], 1);
    assert_eq!(result["items"][0]["file_version"], 2);
    assert!(
        !search(&app, "이전표현", "").await["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == id)
    );
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(search(&app, "new_unique_phrase", "").await["total"], 1);
    app.shutdown().await.unwrap();
}
