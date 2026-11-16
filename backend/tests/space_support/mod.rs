// Purpose: Build small document containers and multipart requests for real Space API tests.
// Pattern: Deterministic local fixtures; no runtime downloads or real application data.
// Usage: Imported by Space integration tests; fixtures exercise upload/byte preservation only.
// Related: backend/tests/space.rs, adapters/formats/.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use std::io::{Cursor, Write};
use tower::ServiceExt;
use zip::{ZipWriter, write::SimpleFileOptions};
pub fn office(extension: &str) -> Vec<u8> {
    let (part, mime) = match extension {
        "pptx" => (
            "ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ),
        "docx" => (
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        "xlsx" => (
            "xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ),
        _ => panic!("unsupported fixture"),
    };
    let types = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/{part}" ContentType="{mime}"/></Types>"#
    );
    archive(&[("[Content_Types].xml",types.as_bytes()),("_rels/.rels",b"<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>"),(part,b"<document/>")])
}
pub fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        zip.start_file(
            *name,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
pub fn pdf() -> Vec<u8> {
    use lopdf::{Document, Object, dictionary};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let page_id=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"MediaBox"=>vec![0.into(),0.into(),200.into(),200.into()]});
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>vec![page_id.into()],"Count"=>1}),
    );
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}
pub fn hwp() -> Vec<u8> {
    let mut file = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    let mut header = [0u8; 40];
    header[..17].copy_from_slice(b"HWP Document File");
    header[35] = 5;
    file.create_stream("FileHeader")
        .unwrap()
        .write_all(&header)
        .unwrap();
    file.into_inner().into_inner()
}
pub fn body(filename: &str, bytes: &[u8], title: &str, tags: &str) -> Vec<u8> {
    let mut body=format!("--space-boundary\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\n{title}\r\n--space-boundary\r\nContent-Disposition: form-data; name=\"tags\"\r\n\r\n{tags}\r\n--space-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n--space-boundary--\r\n");
    body
}
pub async fn upload(
    router: &Router,
    path: &str,
    key: &str,
    version: Option<i64>,
    filename: &str,
    bytes: &[u8],
    title: &str,
) -> (StatusCode, Value) {
    let mut r = Request::builder()
        .method("POST")
        .uri(path)
        .header(
            "Content-Type",
            "multipart/form-data; boundary=space-boundary",
        )
        .header("Idempotency-Key", key);
    if let Some(v) = version {
        r = r.header("X-Expected-Version", v);
    }
    let response = router
        .clone()
        .oneshot(
            r.body(Body::from(body(
                filename,
                bytes,
                title,
                r#"["공용","검증"]"#,
            )))
            .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
pub async fn download(router: &Router, path: &str) -> (StatusCode, Vec<u8>) {
    let response = router
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 60 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}
