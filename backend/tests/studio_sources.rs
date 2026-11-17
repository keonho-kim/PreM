// Purpose: Verify project-scoped originals, shared extraction, immutable versions and stale review fencing.
// Pattern: Real router, local document tools and isolated persistent storage across restart.
// Usage: cargo nextest run --test studio_sources.
// Related: V13__project_sources.sql, document_support/, modules/studio/.
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
use prem_backend::app::Application;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
async fn project(app: &Application, name: &str) -> String {
    let (s, p) = request(
        &app.router(),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":name,"due_date":"2030-12-31"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 201, "{p}");
    p["id"].as_str().unwrap().into()
}
async fn upload(
    app: &Application,
    p: &str,
    target: Option<(&str, i64)>,
    key: &str,
    bytes: &[u8],
) -> (u16, Value) {
    let path = target
        .map(|(id, _)| format!("/api/v1/projects/{p}/files/{id}/versions"))
        .unwrap_or(format!("/api/v1/projects/{p}/files"));
    let mut req = Request::post(path)
        .header(
            "Content-Type",
            "multipart/form-data; boundary=space-boundary",
        )
        .header("Idempotency-Key", key);
    if let Some((_, v)) = target {
        req = req.header("X-Expected-Version", v);
    }
    let r = app
        .router()
        .oneshot(
            req.body(Body::from(space_support::body(
                "original.html",
                bytes,
                "원본",
                "[]",
            )))
            .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status().as_u16();
    let b = to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&b).unwrap())
}
async fn review(app: &Application, p: &str) -> Value {
    let (s, v) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/source-review"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sources_are_scoped_deduplicated_versioned_and_explicitly_confirmed() {
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    let fixture_model = document_support::Fixture::start().await;
    document_support::configure(&app, &fixture_model).await;
    app.start_processing();
    let a = project(&app, "A").await;
    let b = project(&app, "B").await;
    let bytes = document_support::fixture("reference.html");
    assert_eq!(review(&app, &a).await["ready"], false);
    let key = Uuid::new_v4().to_string();
    let (s, item) = upload(&app, &a, None, &key, &bytes).await;
    assert_eq!(s, 201, "{item}");
    let id = item["id"].as_str().unwrap();
    assert_eq!(upload(&app, &a, None, &key, &bytes).await.0, 200);
    assert_eq!(upload(&app, &b, None, &key, &bytes).await.0, 409);
    let (_, list) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{b}/files"),
        None,
        None,
    )
    .await;
    assert_eq!(list["total"], 0);
    for suffix in ["", "/download", "/versions"] {
        assert_eq!(
            request(
                &app.router(),
                "GET",
                &format!("/api/v1/projects/{b}/files/{id}{suffix}"),
                None,
                None
            )
            .await
            .0,
            404
        );
    }
    let (_, space) = request(&app.router(), "GET", "/api/v1/space/all", None, None).await;
    assert_eq!(space["total"], 0);
    let kind = format!("project-{a}");
    let d = document_support::wait(&app, &kind, id, "succeeded").await;
    let state = review(&app, &a).await;
    assert_eq!(state["ready"], true);
    assert_eq!(state["confirmed"], false);
    let path = format!("/api/v1/projects/{a}/source-review");
    let (s, confirmed) = request(
        &app.router(),
        "PUT",
        &path,
        Some(json!({"snapshot":state["snapshot"]})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(confirmed["confirmed"], true);
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &path,
            Some(json!({"snapshot":state["snapshot"]})),
            None
        )
        .await
        .0,
        200
    );
    let reference = document_support::upload(&app, "references", "same.html", &bytes).await;
    let r = document_support::wait(
        &app,
        "references",
        reference["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
    assert_eq!(d["job"]["extraction_id"], r["job"]["extraction_id"]);
    let newbytes=b"<!DOCTYPE html><html><body><h1>New source</h1><p>New content for the presentation.</p></body></html>";
    let (s, next) = upload(
        &app,
        &a,
        Some((id, 1)),
        &Uuid::new_v4().to_string(),
        newbytes,
    )
    .await;
    assert_eq!(s, 201, "{next}");
    assert_eq!(review(&app, &a).await["confirmed"], false);
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &path,
            Some(json!({"snapshot":state["snapshot"]})),
            None
        )
        .await
        .0,
        409
    );
    assert_eq!(
        upload(
            &app,
            &a,
            Some((id, 1)),
            &Uuid::new_v4().to_string(),
            newbytes
        )
        .await
        .0,
        409
    );
    let (s, old) = space_support::download(
        &app.router(),
        &format!("/api/v1/projects/{a}/files/{id}/download?version=1"),
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(old, bytes);
    document_support::wait(&app, &kind, id, "succeeded").await;
    let guide_path = format!("/api/v1/projects/{a}/guide");
    let before_jobs = r["job"]["id"].clone();
    let (s, g) = request(
        &app.router(),
        "PUT",
        &guide_path,
        Some(json!({"expected_version":0,"do_text":"핵심 위주","dont_text":"과장 금지"})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(g["version"], 1);
    assert_eq!(
        request(
            &app.router(),
            "PUT",
            &guide_path,
            Some(json!({"expected_version":0,"do_text":"stale","dont_text":""})),
            None
        )
        .await
        .0,
        409
    );
    assert_eq!(
        document_support::wait(
            &app,
            "references",
            reference["id"].as_str().unwrap(),
            "succeeded"
        )
        .await["job"]["id"],
        before_jobs
    );
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        request(&app.router(), "GET", &guide_path, None, None)
            .await
            .1,
        g
    );
    assert_eq!(
        space_support::download(
            &app.router(),
            &format!("/api/v1/projects/{a}/files/{id}/download?version=1")
        )
        .await
        .1,
        bytes
    );
    let (s, _) = request(
        &app.router(),
        "DELETE",
        &format!("/api/v1/projects/{a}"),
        Some(json!({"expected_version":1})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(
        request(
            &app.router(),
            "GET",
            &format!("/api/v1/projects/{a}/files/{id}"),
            None,
            None
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(
            &app.router(),
            "GET",
            &format!(
                "/api/v1/document-jobs/{}/blocks",
                d["job"]["id"].as_str().unwrap()
            ),
            None,
            None
        )
        .await
        .0,
        404
    );
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM reference_items", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM file_blobs WHERE format='html'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}
