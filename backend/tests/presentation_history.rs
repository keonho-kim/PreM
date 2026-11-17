// Purpose: Verify real comparison previews and three undo steps owned by a disposable editor visit.
// Pattern: Actual APIs, immutable file reuse, scoped cache close/expiry and shutdown/startup cleanup.
// Usage: cargo nextest run --test presentation_history; all data is isolated under QA storage.
// Related: V22 migration, presentation_support/edits.rs, presentations/sessions.rs.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod presentation_support;
#[allow(dead_code)]
mod space_support;
use common::request;
use outline_support::*;
use prem_backend::app::Application;
use presentation_support::{edits::*, *};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use uuid::Uuid;
async fn open(app: &Application, p: &str, r: &Value) -> String {
    let id = Uuid::new_v4().to_string();
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/editor-sessions",
            r["id"].as_str().unwrap()
        ),
        Some(json!({"session_id":id})),
        None,
    )
    .await;
    assert_eq!(s, 201, "{v}");
    id
}
async fn history(app: &Application, p: &str, r: &Value, session: &str) -> Value {
    request(
        &app.router(),
        "GET",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/history?session_id={session}",
            r["id"].as_str().unwrap()
        ),
        None,
        None,
    )
    .await
    .1
}
async fn undo(
    app: &Application,
    p: &str,
    r: &Value,
    key: &str,
    session: &str,
) -> (axum::http::StatusCode, Value) {
    request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/presentations/{}/undo",
            r["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":r["presentation_version"],"editor_session_id":session})),
        Some(key),
    )
    .await
}
async fn prepare_edit(app: &Application, p: &str, current: &Value, title: &str) -> Value {
    let ss = slides(app, p, current).await;
    let path = thread(p, current, &ss);
    let(s,e)=request(&app.router(),"POST",&path,Some(json!({"expected_version":current["presentation_version"],"prompt":title,"fields":["title"]})),Some(&Uuid::new_v4().to_string())).await;
    assert_eq!(s, 202, "{e}");
    proposal(app, &path, "ready").await
}
async fn apply(app: &Application, p: &str, e: &Value, session: &str) {
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!(
            "/api/v1/projects/{p}/slide-edits/{}/apply",
            e["id"].as_str().unwrap()
        ),
        Some(json!({"expected_version":e["version"],"editor_session_id":session})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 200, "{v}");
}
async fn close(app: &Application, p: &str, s: &str) {
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &format!("/api/v1/projects/{p}/editor-sessions/{s}/close"),
            None,
            None
        )
        .await
        .0,
        200
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn three_step_cache_is_isolated_disposable_and_never_recreated_by_late_publication() {
    let f = Fixture::start().await;
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let (p, c, _) = setup(&app, &f).await;
    let design = prepared(&app, &p, &c).await;
    assert_eq!(
        request(
            &app.router(),
            "POST",
            &format!("/api/v1/projects/{p}/presentations"),
            Some(input(&design, &c)),
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        202
    );
    let first = wait_run(&app, &p, "succeeded").await;
    let original = slides(&app, &p, &first).await;
    let mut current = first.clone();
    let session = open(&app, &p, &first).await;
    assert_eq!(
        history(&app, &p, &first, &session).await["undo_remaining"],
        0
    );
    for i in 1..=4 {
        let ss = slides(&app, &p, &current).await;
        let e = prepare_edit(&app, &p, &current, &format!("revision-{i}")).await;
        assert_eq!(e["preview"], true);
        let url = format!(
            "/api/v1/projects/{p}/slide-edits/{}/slides/{}/preview",
            e["id"].as_str().unwrap(),
            ss[0]["id"].as_str().unwrap()
        );
        let (s, bytes) = space_support::download(&app.router(), &url).await;
        assert_eq!(s, 200);
        assert!(bytes.starts_with(b"\x89PNG"));
        assert_eq!(
            space_support::download(&app.router(), &url.replace(&p, &Uuid::new_v4().to_string()))
                .await
                .0,
            404
        );
        let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
        let count = db
            .query_row("SELECT count(*) FROM file_blobs", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap();
        drop(db);
        apply(&app, &p, &e, &session).await;
        let next = wait_run(&app, &p, "succeeded").await;
        let h = history(&app, &p, &next, &session).await;
        assert_eq!(h["before_run_id"], current["id"]);
        assert_eq!(h["undo_remaining"], i.min(3));
        assert_eq!(h["slides"].as_array().unwrap().len(), 2);
        let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM file_blobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            count
        );
        assert!(db.query_row("SELECT c.output_sha256=r.output_sha256 FROM presentation_edit_renders c JOIN presentation_edits e ON e.id=c.edit_id JOIN presentation_revisions r ON r.id=e.applied_run_id WHERE e.id=?",[e["id"].as_str().unwrap()],|r|r.get::<_,bool>(0)).unwrap());
        drop(db);
        current = next;
    }
    let newest = current.clone();
    let calls = f.model.calls.load(Ordering::SeqCst);
    let other = open(&app, &p, &current).await;
    assert_eq!(
        history(&app, &p, &current, &other).await["undo_remaining"],
        0
    );
    close(&app, &p, &other).await;
    assert_eq!(
        undo(
            &app,
            &Uuid::new_v4().to_string(),
            &current,
            &Uuid::new_v4().to_string(),
            &session
        )
        .await
        .0,
        404
    );
    assert_eq!(
        undo(&app, &p, &first, &Uuid::new_v4().to_string(), &session)
            .await
            .0,
        409
    );
    for i in 0..3 {
        let key = Uuid::new_v4().to_string();
        let (s, next) = undo(&app, &p, &current, &key, &session).await;
        assert_eq!(s, 200, "{next}");
        assert_eq!(next["presentation_version"], 6 + i);
        let (s, replay) = undo(&app, &p, &current, &key, &session).await;
        assert_eq!(s, 200);
        assert_eq!(replay["id"], next["id"]);
        assert_eq!(
            slides(&app, &p, &next).await[0]["spec"]["title"],
            format!("revision-{}", 3 - i)
        );
        assert_eq!(
            history(&app, &p, &next, &session).await["undo_remaining"],
            2 - i
        );
        current = next;
    }
    assert_eq!(
        undo(&app, &p, &current, &Uuid::new_v4().to_string(), &session)
            .await
            .0,
        422
    );
    assert_eq!(f.model.calls.load(Ordering::SeqCst), calls);
    assert_eq!(slides(&app, &p, &first).await, original);
    assert_eq!(
        slides(&app, &p, &newest).await[0]["spec"]["title"],
        "revision-4"
    );
    let e = prepare_edit(&app, &p, &current, "revision-late").await;
    apply(&app, &p, &e, &session).await;
    close(&app, &p, &session).await;
    current = wait_run(&app, &p, "succeeded").await;
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM presentation_editor_sessions",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM presentation_undo_stack", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(db);
    let fresh = open(&app, &p, &current).await;
    assert_eq!(
        history(&app, &p, &current, &fresh).await["undo_remaining"],
        0
    );
    let e = prepare_edit(&app, &p, &current, "revision-expire").await;
    apply(&app, &p, &e, &fresh).await;
    current = wait_run(&app, &p, "succeeded").await;
    assert_eq!(
        history(&app, &p, &current, &fresh).await["undo_remaining"],
        1
    );
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute(
        "UPDATE presentation_editor_sessions SET expires_at=0 WHERE id=?",
        [&fresh],
    )
    .unwrap();
    drop(db);
    assert_eq!(
        request(
            &app.router(),
            "PATCH",
            &format!("/api/v1/projects/{p}/editor-sessions/{fresh}"),
            None,
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        history(&app, &p, &current, &fresh).await["undo_remaining"],
        0
    );
    let _ = open(&app, &p, &current).await;
    app.shutdown().await.unwrap();
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM presentation_editor_sessions",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    // Simulate an abruptly abandoned session; startup must clear cache references, not revisions.
    db.execute(
        "INSERT INTO presentation_editor_sessions VALUES(?,?,?,?,9999999999999)",
        rusqlite::params![
            session,
            p,
            current["presentation_id"].as_str().unwrap(),
            current["id"].as_str().unwrap()
        ],
    )
    .unwrap();
    db.execute(
        "INSERT INTO presentation_undo_stack VALUES(?,1,?)",
        rusqlite::params![session, first["id"].as_str().unwrap()],
    )
    .unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    assert_eq!(
        history(&app, &p, &current, &session).await["undo_remaining"],
        0
    );
    assert_eq!(slides(&app, &p, &first).await, original);
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    drop(db);
    app.shutdown().await.unwrap();
}
