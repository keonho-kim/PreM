// Purpose: Verify actual authoring HTTP payloads retain long Korean source context.
// Pattern: Isolated real storage and a recording synthetic provider; no production data.
// Usage: cargo nextest run --test prompt_context.
// Related: outline_support/, inference/context.rs, sqlite/outlines/plans.rs.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use prem_backend::app::Application;
use serde_json::json;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_source_reaches_outline_model_and_retains_coverage_metadata() {
    let fixture = outline_support::Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (project, connection, _) = outline_support::setup(&app, &fixture).await;
    let source = format!(
        "계획의 시작 {} 반드시 보존할 마지막 예외 조건",
        "한국어 업무 문맥입니다. ".repeat(50)
    );
    let upload = outline_support::source_upload(&app, &project, &source).await;
    let id = upload["id"].as_str().unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let (status, job) = common::request(
                &app.router(),
                "GET",
                &format!("/api/v1/projects/{project}/files/{id}/processing"),
                None,
                None,
            )
            .await;
            assert_eq!(status, 200);
            assert_ne!(job["job"]["status"], "failed", "{job}");
            if job["job"]["status"] == "succeeded" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    let path = format!("/api/v1/projects/{project}/source-review");
    let (_, review) = common::request(&app.router(), "GET", &path, None, None).await;
    assert_eq!(
        common::request(
            &app.router(),
            "PUT",
            &path,
            Some(json!({"snapshot":review["snapshot"]})),
            None
        )
        .await
        .0,
        200
    );
    outline_support::create(&app, &project, &connection, "generate").await;
    outline_support::wait(&app, &project, "succeeded").await;
    {
        let requests = fixture.model.requests.lock().unwrap();
        let input = requests.iter().find(|r| r["task"] == "generate").unwrap();
        let excerpts = input["source_excerpts"].as_array().unwrap();
        let long = excerpts
            .iter()
            .find(|e| e["text"].as_str().unwrap().contains("마지막 예외 조건"))
            .unwrap();
        assert_eq!(long["text"], source);
        assert_eq!(long["partial"], false);
        assert_eq!(input["source_coverage"]["provided_blocks"], excerpts.len());
    }
    app.shutdown().await.unwrap();
}
