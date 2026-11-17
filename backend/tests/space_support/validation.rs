// Purpose: Reject malformed upload formats while accepting the supported container fixtures.
// Pattern: Real HTTP validation and owned staging cleanup checks.
// Usage: Included by the Space integration test binary.
// Related: mod.rs, ../space.rs, adapters/formats/.
use super::space_support::upload;
use super::{common, space_support};
use axum::http::StatusCode;
use prem_backend::app::Application;
use uuid::Uuid;
#[tokio::test]
async fn supported_formats_and_invalid_files_are_separated() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let hwpx = space_support::archive(&[
        ("mimetype", b"application/hwp+zip"),
        ("Contents/content.hpf", b"<package/>"),
        ("Contents/section0.xml", b"<section/>"),
    ]);
    for (name, bytes) in [
        ("원본.pdf", space_support::pdf()),
        ("원본.hwp", space_support::hwp()),
        ("원본.hwpx", hwpx),
        ("원본.docx", space_support::office("docx")),
        ("원본.xlsx", space_support::office("xlsx")),
    ] {
        let (status, result) = upload(
            &router,
            "/api/v1/space/references",
            &Uuid::new_v4().to_string(),
            None,
            name,
            &bytes,
            "원본",
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{name}: {result}");
    }
    for (name, bytes) in [
        ("위장.pdf", b"not a PDF".to_vec()),
        ("위장.pptx", space_support::office("docx")),
        ("../탈출.pdf", space_support::pdf()),
        ("빈.pdf", Vec::new()),
        ("실행.exe", b"MZ".to_vec()),
        (
            "깨짐.pptx",
            space_support::archive(&[("../escape", b"escape")]),
        ),
    ] {
        let (status, result) = upload(
            &router,
            "/api/v1/space/references",
            &Uuid::new_v4().to_string(),
            None,
            name,
            &bytes,
            "원본",
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{name}: {result}");
    }
    let (status, _) = upload(
        &router,
        "/api/v1/space/templates",
        &Uuid::new_v4().to_string(),
        None,
        "문서.pdf",
        &space_support::pdf(),
        "원본",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let bomb = space_support::archive(&[("large", &vec![0; 2 * 1024 * 1024])]);
    assert_eq!(
        upload(
            &router,
            "/api/v1/space/references",
            &Uuid::new_v4().to_string(),
            None,
            "압축.pptx",
            &bomb,
            "원본"
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        std::fs::read_dir(root.path().join("blobs/.staging"))
            .unwrap()
            .count(),
        0
    );
    app.shutdown().await.unwrap();
}
