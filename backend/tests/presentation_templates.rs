// Purpose: Verify native template reuse preserves masters and remains project-scoped/versioned.
// Pattern: Actual PPTX fixture upload, extraction, generation and editable package assertions.
// Usage: cargo nextest run --test presentation_templates.
// Related: presentation_support/, modules/presentations/, template rendering adapter.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use presentation_support::*;
use puputyx_backend::app::Application;
use serde_json::json;
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn template_output_preserves_native_master_and_rejects_foreign_reads() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    let bytes = include_bytes!("../../tests/fixtures/documents/native-template.pptx");
    let (s, asset) = space_support::upload(
        &app.router(),
        "/api/v1/space/templates",
        &Uuid::new_v4().to_string(),
        None,
        "team.pptx",
        bytes,
        "팀 템플릿",
    )
    .await;
    assert_eq!(s, 201, "{asset}");
    let id = asset["id"].as_str().unwrap();
    let job = tokio::time::timeout(std::time::Duration::from_secs(40), async {
        loop {
            let (_, d) = request(
                &app.router(),
                "GET",
                &format!("/api/v1/space/templates/{id}/processing"),
                None,
                None,
            )
            .await;
            assert_ne!(d["job"]["status"], "failed", "{d}");
            if d["job"]["status"] == "succeeded" {
                break d["job"]["id"].clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    let(s,selected)=request(&app.router(),"PUT",&format!("/api/v1/projects/{p}/presentation-preparation/design"),Some(json!({"expected_version":design["version"],"evidence_review_id":design["evidence_review_id"],"template_job_id":job})),None).await;
    assert_eq!(s, 200, "{selected}");
    let(s,_)=request(&app.router(),"PUT",&format!("/api/v1/projects/{p}/presentation-preparation/design"),Some(json!({"expected_version":design["version"],"evidence_review_id":design["evidence_review_id"],"template_job_id":null})),None).await;
    assert_eq!(s, 409);
    let (s, r) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentations"),
        Some(input(&selected, &c)),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{r}");
    let done = wait_run(&app, &p, "succeeded").await;
    let run = done["id"].as_str().unwrap();
    let (s, output) = space_support::download(
        &app.router(),
        &format!("/api/v1/projects/{p}/presentations/{run}/download"),
    )
    .await;
    assert_eq!(s, 200);
    assert!(output.starts_with(b"PK"));
    let mut original = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut generated = zip::ZipArchive::new(std::io::Cursor::new(output)).unwrap();
    use std::io::Read;
    let mut expected = vec![];
    let mut actual = vec![];
    original
        .by_name("ppt/slideMasters/slideMaster1.xml")
        .unwrap()
        .read_to_end(&mut expected)
        .unwrap();
    generated
        .by_name("ppt/slideMasters/slideMaster1.xml")
        .unwrap()
        .read_to_end(&mut actual)
        .unwrap();
    assert_eq!(actual, expected, "Template master is preserved");
    let (s, _) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{}/presentations/{run}/slides",
            Uuid::new_v4()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(s, 404);
    app.shutdown().await.unwrap();
}
