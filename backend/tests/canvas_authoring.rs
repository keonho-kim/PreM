// Purpose: Verify blank authoring and direct geometry writes use real native output without model calls.
// Pattern: Actual HTTP/SQLite/tools and disposable QA storage; optimistic revisions preserve originals.
// Usage: cargo nextest run --test canvas_authoring; no credentials or business data are needed.
// Related: V30 migration, presentations/canvas.rs, presentation_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use prem_backend::app::Application;
use presentation_support::wait_run;
use serde_json::{Value, json};
use uuid::Uuid;
async fn post(app: &Application, url: &str, value: Value) -> Value {
    let (s, v) = request(
        &app.router(),
        "POST",
        url,
        Some(value),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    v
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_template_supports_title_body_and_blank_layouts_without_inference() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let project = post(
        &app,
        "/api/v1/projects",
        json!({"name":"기본 디자인","due_date":"2030-01-01"}),
    )
    .await;
    let p = project["id"].as_str().unwrap();
    let path = format!("/api/v1/projects/{p}/presentations");
    let (status, layouts) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentation-layouts"),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{layouts}");
    assert_eq!(layouts[1]["key"], "title-body");
    assert_eq!(layouts[1]["slots"][0]["role"], "title");
    assert_eq!(layouts[1]["slots"][1]["role"], "body");
    let (status, _) = request(
        &app.router(),
        "POST",
        &format!("{path}/blank"),
        Some(json!({"title":"기본","template_job_id":null,"layout_key":"0:1"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(
        status, 422,
        "A native template layout requires its actual template"
    );
    post(
        &app,
        &format!("{path}/blank"),
        json!({"title":"기본 배치","template_job_id":null,"layout_key":"title-body"}),
    )
    .await;
    let first = wait_run(&app, p, "succeeded").await;
    let run = first["id"].as_str().unwrap();
    let (_, slides) = request(
        &app.router(),
        "GET",
        &format!("{path}/{run}/slides"),
        None,
        None,
    )
    .await;
    assert_eq!(slides[0]["spec"]["design"]["layout_key"], "title-body");
    assert_eq!(slides[0]["spec"]["title"], "");
    let (status, bytes) =
        space_support::download(&app.router(), &format!("{path}/{run}/download")).await;
    assert_eq!(status, 200);
    let mut deck = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    use std::io::Read;
    let mut xml = String::new();
    deck.by_name("ppt/slides/slide1.xml")
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    assert_eq!(
        xml.matches("<p:ph ").count(),
        2,
        "Native title/body placeholders remain editable"
    );
    post(&app, &format!("{path}/{run}/canvas"), json!({"expected_version":1,"slide_id":slides[0]["id"],"session":null,"operation":{"kind":"add_slide","layout_key":"blank"}})).await;
    let next = wait_run(&app, p, "succeeded").await;
    let (_, slides) = request(
        &app.router(),
        "GET",
        &format!("{path}/{}/slides", next["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(slides.as_array().unwrap().len(), 2);
    assert_eq!(slides[1]["spec"]["design"]["layout_key"], "blank");
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    for table in ["llm_requests", "llm_provider_connections", "template_items"] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    app.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn blank_canvas_moves_objects_without_models_and_keeps_immutable_revisions() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let p = post(
        &app,
        "/api/v1/projects",
        json!({"name":"직접 작성","due_date":"2030-01-01"}),
    )
    .await;
    let p = p["id"].as_str().unwrap();
    let path = format!("/api/v1/projects/{p}/presentations");
    let (s, layouts) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentation-layouts"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{layouts}");
    assert_eq!(layouts[0]["key"], "blank");
    post(
        &app,
        &format!("{path}/blank"),
        json!({"title":"직접 작성","template_job_id":null,"layout_key":"blank"}),
    )
    .await;
    let first = wait_run(&app, p, "succeeded").await;
    assert_eq!(first["manual"], true);
    let (_, slides) = request(
        &app.router(),
        "GET",
        &format!("{path}/{}/slides", first["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(slides[0]["spec"]["design"]["authored"], true);
    assert_eq!(slides[0]["spec"]["title"], "");
    let slide = slides[0]["id"].as_str().unwrap();
    let frame = json!({"x":15,"y":20,"width":25,"height":30,"rotation":0});
    post(&app,&format!("{path}/{}/canvas",first["id"].as_str().unwrap()),json!({"expected_version":1,"slide_id":slide,"session":null,"operation":{"kind":"insert","object":{"id":"diagram","name":"도식","frame":frame,"content":{"kind":"shape","shape":"rectangle","fill":"#E3EAE4"}}}})).await;
    let second = wait_run(&app, p, "succeeded").await;
    assert_eq!(second["presentation_version"], 2);
    let (_, next) = request(
        &app.router(),
        "GET",
        &format!("{path}/{}/slides", second["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    let (status, layers) = request(
        &app.router(),
        "GET",
        &format!(
            "{path}/{}/slides/{}/layers",
            second["id"].as_str().unwrap(),
            next[0]["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{layers}");
    assert_eq!(layers.as_array().unwrap().len(), 2, "{layers}");
    let command = json!({"expected_version":2,"slide_id":next[0]["id"],"session":null,"operation":{"kind":"geometry","placements":[{"object_id":"diagram","frame":{"x":40,"y":35,"width":35,"height":25,"rotation":0}}]}});
    let key = Uuid::new_v4().to_string();
    let (s, queued) = request(
        &app.router(),
        "POST",
        &format!("{path}/{}/canvas", second["id"].as_str().unwrap()),
        Some(command.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{queued}");
    let third = wait_run(&app, p, "succeeded").await;
    let (s, replayed) = request(
        &app.router(),
        "POST",
        &format!("{path}/{}/canvas", second["id"].as_str().unwrap()),
        Some(command.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202);
    assert_eq!(replayed["id"], third["id"]);
    let (s, _) = request(
        &app.router(),
        "POST",
        &format!("{path}/{}/canvas", second["id"].as_str().unwrap()),
        Some(command),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 409);
    let (_, moved) = request(
        &app.router(),
        "GET",
        &format!("{path}/{}/slides", third["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(moved[0]["spec"]["objects"][0]["frame"]["x"], 40.0);
    let (_, old) = request(
        &app.router(),
        "GET",
        &format!("{path}/{}/slides", second["id"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(old[0]["spec"]["objects"][0]["frame"]["x"], 15.0);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    for table in [
        "llm_requests",
        "llm_provider_connections",
        "outline_revisions",
        "presentation_evidence_reviews",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        )
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    app.shutdown().await.unwrap();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    assert_eq!(wait_run(&app, p, "succeeded").await["id"], third["id"]);
    app.shutdown().await.unwrap();
}
