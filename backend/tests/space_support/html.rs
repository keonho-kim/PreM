// Purpose: Verify HTML originals, attachment safety, format rejection and version persistence.
// Pattern: Real HTTP requests against isolated storage, with executable-looking inert fixtures.
// Usage: Included by backend/tests/space.rs; no network resources are required by fixtures.
// Related: adapters/formats/html.rs, http/space/mod.rs, upload-engine.test.ts.
use crate::{
    common,
    space_support::{download, upload},
};
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use puputyx_backend::app::Application;
use tower::ServiceExt;
use uuid::Uuid;
const HTML: &str = "<!DOCTYPE html><html lang='ko'><meta charset='utf-8'><title>팀 문서</title><body><h1>안내</h1><script>window.puputyxHtmlExecuted=true</script><img src='https://html-fixture.invalid/tracker'></body></html>";
#[tokio::test]
async fn html_originals_are_download_only_versioned_and_survive_restart() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let key = Uuid::new_v4().to_string();
    let (status, item) = upload(
        &router,
        "/api/v1/space/references",
        &key,
        None,
        "팀 문서.HTML",
        HTML.as_bytes(),
        "팀 문서",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    assert_eq!(item["format"], "html");
    assert_eq!(item["mime"], "text/html");
    let id = item["id"].as_str().unwrap();
    let path = format!("/api/v1/space/references/{id}");
    let response = router
        .clone()
        .oneshot(
            Request::get(format!("{path}/download"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "text/html");
    assert!(
        response.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment;")
    );
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        response.headers()["content-security-policy"],
        "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
    );
    assert_eq!(
        to_bytes(response.into_body(), 10000)
            .await
            .unwrap()
            .as_ref(),
        HTML.as_bytes()
    );
    let replacement = "\u{feff}<ARTICLE><h2>새 내용</h2><p>태그 생략도 허용";
    let (status, changed) = upload(
        &router,
        &format!("{path}/versions"),
        &Uuid::new_v4().to_string(),
        Some(1),
        "교체.htm",
        replacement.as_bytes(),
        "팀 문서",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{changed}");
    assert_eq!(changed["file_version"], 2);
    app.shutdown().await.unwrap();
    let restarted = Application::open(root.path()).unwrap();
    assert_eq!(
        download(&restarted.router(), &format!("{path}/download?version=1"))
            .await
            .1,
        HTML.as_bytes()
    );
    assert_eq!(
        download(&restarted.router(), &format!("{path}/download"))
            .await
            .1,
        replacement.as_bytes()
    );
    restarted.shutdown().await.unwrap();
}
#[tokio::test]
async fn html_rejects_binary_plain_text_wrong_encoding_and_template_registration() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    for (name, bytes, code) in [
        (
            "plain.html",
            b"plain text, no markup".as_slice(),
            "invalid_file",
        ),
        (
            "comment.htm",
            b"<!-- <html><p>not a document</p></html> -->",
            "invalid_file",
        ),
        ("binary.html", b"<html>\0binary</html>", "invalid_file"),
        ("encoding.html", b"<p>\xff\xfe</p>", "invalid_file"),
        ("partial.html", b"<html", "invalid_file"),
        ("unsupported.exe", b"# Markdown", "invalid_file"),
    ] {
        let (status, body) = upload(
            &app.router(),
            "/api/v1/space/references",
            &Uuid::new_v4().to_string(),
            None,
            name,
            bytes,
            "잘못된 문서",
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{name}: {body}");
        assert_eq!(body["code"], code);
        if name == "encoding.html" {
            assert!(body["message"].as_str().unwrap().contains("UTF-8"));
        }
    }
    let (status, _) = upload(
        &app.router(),
        "/api/v1/space/templates",
        &Uuid::new_v4().to_string(),
        None,
        "template.html",
        HTML.as_bytes(),
        "템플릿",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        std::fs::read_dir(root.path().join("blobs/.staging"))
            .unwrap()
            .count(),
        0
    );
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn html_complexity_is_bounded_without_building_a_dom() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let body = "<br>".repeat(1_000_001);
    let (status, error) = upload(
        &app.router(),
        "/api/v1/space/references",
        &Uuid::new_v4().to_string(),
        None,
        "complex.html",
        body.as_bytes(),
        "복잡한 문서",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(error["message"].as_str().unwrap().contains("복잡"));
    app.shutdown().await.unwrap();
}
