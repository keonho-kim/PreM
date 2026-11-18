// Purpose: Verify Markdown upload, immutable extraction, original downloads and format-specific reuse.
// Pattern: Real product HTTP/SQLite with a synthetic local model connection; all storage is isolated.
// Usage: cargo nextest run --test markdown_documents.
// Related: adapters/markdown/, V1__baseline.sql, tests/fixtures/documents/reference.md.
mod common;
#[allow(dead_code)]
mod document_support;
#[allow(dead_code)]
mod space_support;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use common::request;
use document_support::{fixture, upload, wait};
use prem_backend::app::Application;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
async fn blocks(app: &Application, detail: &Value) -> Vec<Value> {
    let (status, result) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/document-jobs/{}/blocks",
            detail["job"]["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{result}");
    result.as_array().unwrap().clone()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn markdown_is_shared_searchable_structured_and_survives_replacement_and_restart() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let bytes = fixture("reference.md");
    let item = upload(&app, "references", "보고서.MD", &bytes).await;
    assert_eq!(item["format"], "md");
    assert_eq!(item["mime"], "text/markdown");
    let id = item["id"].as_str().unwrap();
    let detail = wait(&app, "references", id, "succeeded").await;
    let data = blocks(&app, &detail).await;
    assert_eq!(detail["page_mode"], "unpaginated");
    assert!(
        detail["job"]["profile"]
            .as_str()
            .unwrap()
            .starts_with("markdown-comrak-0.59.0")
    );
    assert!(!detail["template_extractable"].as_bool().unwrap());
    assert!(data.iter().any(|b| b["kind"] == "heading"
        && b["text"] == "운영 보고서"
        && b["attributes"]["level"] == 1));
    assert!(data.iter().any(|b| b["attributes"]["checked"] == true));
    assert!(data.iter().any(|b| b["attributes"]["checked"] == false));
    assert!(data.iter().any(|b| b["attributes"]["quote_depth"] == 1));
    let code = data
        .iter()
        .find(|b| b["kind"] == "code" && b["attributes"]["language"] == "javascript")
        .unwrap();
    assert!(
        code["text"]
            .as_str()
            .unwrap()
            .contains("<img src=x onerror=alert(1)>")
    );
    assert!(data.iter().any(|b| b["attributes"]["literal_html"] == true));
    let row = data
        .iter()
        .find(|b| b["kind"] == "table" && b["attributes"]["row"] == 1)
        .unwrap();
    assert_eq!(row["text"], "정리\t120");
    let end = row["attributes"]["cells"][0]["end"].as_u64().unwrap() as usize;
    assert_eq!(&row["text"].as_str().unwrap()[..end], "정리");
    assert!(
        data.iter()
            .all(|b| b["attributes"]["source"]["start_line"].as_u64().unwrap() > 0)
    );
    assert!(data.iter().any(|b| {
        b["attributes"]["references"]
            .as_array()
            .is_some_and(|r| r.iter().any(|r| r["kind"] == "image"))
    }));
    assert!(data.iter().all(|b| b["image"].is_null()));
    let path = format!("/api/v1/space/references/{id}");
    let response = app
        .router()
        .oneshot(
            Request::get(format!("{path}/download"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let headers = response.headers().clone();
    assert_eq!(
        to_bytes(response.into_body(), 100000)
            .await
            .unwrap()
            .as_ref(),
        bytes
    );
    assert_eq!(headers["content-type"], "text/markdown");
    assert!(
        headers["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("sandbox")
    );
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment")
    );
    let (_, found) = request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/document-jobs/{}/blocks?q=120",
            detail["job"]["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await;
    assert!(!found.as_array().unwrap().is_empty());
    let (_, project) = request(
        &app.router(),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"Markdown source","due_date":"2030-01-01"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    let project_id = project["id"].as_str().unwrap();
    let response = app
        .router()
        .oneshot(
            Request::post(format!("/api/v1/projects/{project_id}/files"))
                .header(
                    "Content-Type",
                    "multipart/form-data; boundary=space-boundary",
                )
                .header("Idempotency-Key", Uuid::new_v4().to_string())
                .body(Body::from(space_support::body(
                    "보고서.markdown",
                    &bytes,
                    "원본",
                    "[]",
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let source: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap();
    let source_id = source["id"].as_str().unwrap();
    let kind = format!("project-{project_id}");
    let source_detail = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let (_, d) = request(
                &app.router(),
                "GET",
                &format!("/api/v1/projects/{project_id}/files/{source_id}/processing"),
                None,
                None,
            )
            .await;
            if d["job"]["status"] == "succeeded" {
                break d;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        source_detail["job"]["extraction_id"], detail["job"]["extraction_id"],
        "{kind}"
    );
    let (status, _) = space_support::upload(
        &app.router(),
        &format!("{path}/versions"),
        &Uuid::new_v4().to_string(),
        Some(1),
        "새 문서.markdown",
        "# 수정된 내용\n\n새 원본".as_bytes(),
        "보고서",
    )
    .await;
    assert_eq!(status, 201);
    let next = wait(&app, "references", id, "succeeded").await;
    assert_ne!(next["job"]["extraction_id"], detail["job"]["extraction_id"]);
    let old_job = detail["job"]["id"].as_str().unwrap().to_owned();
    let id = id.to_owned();
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, current) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/space/references/{id}/processing"),
        None,
        None,
    )
    .await;
    assert_eq!(
        current["job"]["extraction_id"],
        next["job"]["extraction_id"]
    );
    let (_, old) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/document-jobs/{old_job}/blocks"),
        None,
        None,
    )
    .await;
    assert_eq!(old, json!(data));
    app.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identical_html_and_markdown_bytes_share_storage_but_keep_distinct_interpretations() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    for order in [["same.html", "same.md"], ["other.md", "other.html"]] {
        let text = format!("<h1>{}</h1>\n<script>privateLiteral()</script>", order[0]);
        let mut details = Vec::new();
        let mut hashes = Vec::new();
        for name in order {
            let item = upload(&app, "references", name, text.as_bytes()).await;
            let format = if name.ends_with("md") { "md" } else { "html" };
            assert_eq!(item["format"], format);
            assert_eq!(
                item["mime"],
                if format == "md" {
                    "text/markdown"
                } else {
                    "text/html"
                }
            );
            hashes.push(item["sha256"].clone());
            let d = wait(
                &app,
                "references",
                item["id"].as_str().unwrap(),
                "succeeded",
            )
            .await;
            let data = blocks(&app, &d).await;
            assert_eq!(
                serde_json::to_string(&data)
                    .unwrap()
                    .contains("privateLiteral"),
                format == "md"
            );
            details.push(d);
        }
        assert_eq!(hashes[0], hashes[1]);
        assert_ne!(
            details[0]["job"]["extraction_id"],
            details[1]["job"]["extraction_id"]
        );
    }
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM file_blobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    drop(db);
    app.shutdown().await.unwrap();
}

#[tokio::test]
async fn markdown_validation_rejects_binary_encoding_empty_limits_and_templates() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    for bytes in [
        vec![0xff, 0xfe, 0x41, 0],
        b"abc\0def".to_vec(),
        b" \n\t".to_vec(),
        space_support::pdf(),
        vec![b'a'; 2 * 1024 * 1024 + 1],
        vec![b'a'; 65537],
    ] {
        let (status, _) = space_support::upload(
            &app.router(),
            "/api/v1/space/references",
            &Uuid::new_v4().to_string(),
            None,
            "invalid.md",
            &bytes,
            "invalid",
        )
        .await;
        assert_eq!(status, 422);
    }
    let (status, _) = space_support::upload(
        &app.router(),
        "/api/v1/space/templates",
        &Uuid::new_v4().to_string(),
        None,
        "template.md",
        b"# Title",
        "invalid",
    )
    .await;
    assert_eq!(status, 422);
    let item = upload(
        &app,
        "references",
        "plain.markdown",
        "\u{feff}태그 없는 일반 본문\r\n두 번째 줄".as_bytes(),
    )
    .await;
    assert_eq!(item["format"], "md");
    app.shutdown().await.unwrap();
}
