// Purpose: Verify native reference insertion, lineage, immutable revisions and replay-safe admission.
// Pattern: Actual extraction/rendering with synthetic PPTX and existing model fixture only.
// Usage: cargo nextest run --test presentation_references; QA storage never touches app data.
// Related: V27 migration, presentation-references.py, presentation_support/.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::edits::slides;
use presentation_support::*;
use serde_json::json;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_slides_charts_and_images_insert_without_copying_source_blobs_and_survive_restart() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let (s, v) = request(
        &common::router(&app),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&design, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    let first = wait_run(&app, &p, "succeeded").await;
    let original = slides(&app, &p, &first).await;
    let asset = document_support::upload(
        &app,
        "references",
        "reference-materials.pptx",
        &document_support::fixture("reference-materials.pptx"),
    )
    .await;
    let detail = document_support::wait(
        &app,
        "references",
        asset["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    let job = detail["job"]["id"].as_str().unwrap();
    let (s, catalog) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/document-jobs/{job}/materials?kind=all"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{catalog}");
    let materials = catalog["items"].as_array().unwrap();
    let chosen: Vec<_> = ["slide", "chart", "image"]
        .iter()
        .map(|kind| materials.iter().find(|m| m["kind"] == *kind).expect(kind))
        .collect();
    let i = json!({"expected_version":1,"slide_id":original[0]["id"],"items":chosen.iter().map(|m|json!({"job_id":job,"material_id":m["id"]})).collect::<Vec<_>>()});
    let key = Uuid::new_v4().to_string();
    let route = format!(
        "/api/v1/projects/{p}/presentations/{}/materials",
        first["id"].as_str().unwrap()
    );
    let (s, run) = request(
        &common::router(&app),
        "POST",
        &route,
        Some(i.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{run}");
    let ready = wait_run(&app, &p, "succeeded").await;
    assert_eq!(ready["presentation_version"], 2);
    let inserted = slides(&app, &p, &ready).await;
    assert_eq!(
        inserted.as_array().unwrap().len(),
        original.as_array().unwrap().len() + 1
    );
    assert_ne!(inserted[0]["id"], original[0]["id"]);
    assert_eq!(inserted[2]["id"], original[1]["id"]);
    assert_eq!(inserted[0]["spec"]["objects"].as_array().unwrap().len(), 2);
    let (status, lineage) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/slides/{}/materials",
            ready["id"].as_str().unwrap(),
            inserted[0]["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{lineage}");
    assert_eq!(lineage.as_array().unwrap().len(), 2);
    assert!(
        lineage
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["job_id"] == job && v["file_version"] == 1)
    );
    let (s, replayed) = request(
        &common::router(&app),
        "POST",
        &route,
        Some(i.clone()),
        Some(&key),
    )
    .await;
    assert_eq!(s, 202, "{replayed}");
    assert_eq!(replayed["id"], run["id"]);
    let (s, _) = request(
        &common::router(&app),
        "POST",
        &route,
        Some(i),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 409);
    let db_read = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let hash: String = db_read
        .query_row(
            "SELECT output_sha256 FROM presentation_revisions WHERE id=?",
            [ready["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    let bytes = std::fs::read(root.path().join(format!(
        "blobs/sha256/{}/{}/{}",
        &hash[..2],
        &hash[2..4],
        hash
    )))
    .unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let names: Vec<_> = archive
        .file_names()
        .map(|n| n.unwrap().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .any(|n| n.starts_with("ppt/charts/chart") && n.ends_with(".xml"))
    );
    assert!(names.iter().any(|n| n.ends_with(".xlsx")));
    use std::io::Read;
    let mut source_text = String::new();
    for name in names
        .iter()
        .filter(|n| n.ends_with(".xml") && n.contains("slide"))
    {
        let mut text = String::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        source_text.push_str(&text);
    }
    assert!(source_text.contains("graphicFrame"));
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM presentation_material_imports",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_slide_imports", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    let diagram = materials.iter().find(|m| m["kind"] == "diagram").unwrap();
    let(status,added)=request(&common::router(&app),"POST",&format!("/api/v1/projects/{p}/presentations/{}/materials",ready["id"].as_str().unwrap()),Some(json!({"expected_version":2,"slide_id":inserted[0]["id"],"items":[{"job_id":job,"material_id":diagram["id"]}]})),Some(&Uuid::new_v4().to_string())).await;
    assert_eq!(status, 202, "{added}");
    let diagram_ready = wait_run(&app, &p, "succeeded").await;
    assert_eq!(diagram_ready["presentation_version"], 3);
    let diagram_slides = slides(&app, &p, &diagram_ready).await;
    assert_eq!(
        diagram_slides[0]["spec"]["objects"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    // The same source choices can be pinned before the first generated output.
    let mut generation = input(&design, &c);
    generation["materials"] = json!(
        chosen
            .iter()
            .map(|m| json!({"job_id":job,"material_id":m["id"]}))
            .collect::<Vec<_>>()
    );
    db.execute_batch("CREATE TRIGGER qa_reference_enrichment BEFORE INSERT ON presentation_reference_drafts BEGIN SELECT RAISE(ABORT,'synthetic reference application failure'); END;").unwrap();
    let (status, created) = request(
        &common::router(&app),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(generation),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202, "{created}");
    let interrupted = wait_run(&app, &p, "failed").await;
    let prior = f.model.calls.load(std::sync::atomic::Ordering::SeqCst);
    db.execute_batch("DROP TRIGGER qa_reference_enrichment;")
        .unwrap();
    let (status, retry) = request(
        &common::router(&app),
        "POST",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/retry",
            interrupted["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":interrupted["version"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 200, "{retry}");
    let combined = wait_run(&app, &p, "succeeded").await;
    assert_eq!(
        f.model.calls.load(std::sync::atomic::Ordering::SeqCst),
        prior
    );
    assert_eq!(combined["total"], 3);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM presentation_reference_drafts",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    // Let the bounded agent discover an uploaded chart and render it as a real native reference.
    let deck = slides(&app, &p, &combined).await;
    let path = presentation_support::edits::thread(&p, &combined, &deck);
    let (status, edit) = request(
        &common::router(&app),
        "POST",
        &path,
        Some(json!({"expected_version":1,"prompt":"레퍼런스 차트 넣어줘","fields":["objects"]})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(status, 202, "{edit}");
    let proposal = presentation_support::edits::proposal(&app, &path, "ready").await;
    assert!(
        proposal["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["state"] == "succeeded")
    );
    assert_eq!(
        proposal["proposal"]["objects"][0]["content"]["kind"],
        "reference"
    );
    assert_eq!(combined["presentation_version"], 1);
    presentation_support::edits::command(&app, &p, &proposal, "apply").await;
    let updated = wait_run(&app, &p, "succeeded").await;
    assert_eq!(updated["presentation_version"], 2);
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    app.shutdown().await.unwrap();
    common::legacy::mark(&db, 36);
    let prior = f.model.calls.load(std::sync::atomic::Ordering::SeqCst);
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    assert_eq!(slides(&app, &p, &ready).await, inserted);
    let restored = presentation_support::edits::proposal(&app, &path, "applied").await;
    assert!(
        restored["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["state"] == "succeeded")
    );
    assert_eq!(
        f.model.calls.load(std::sync::atomic::Ordering::SeqCst),
        prior
    );
    app.shutdown().await.unwrap();
}
