// Purpose: Verify Home deadlines, lifecycle concurrency and preserved migration data.
// Pattern: Real HTTP/SQLite boundaries with isolated fixtures and restart checks.
// Usage: cargo nextest run --test project_home.
// Related: migrations/V2__project_home.sql, adapters/http/projects.rs.
mod common;
use axum::http::StatusCode;
use puputyx_backend::app::Application;
use rusqlite::Connection;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn deadlines_filters_and_lifecycle_are_durable_and_conditional() {
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    for date in [
        "2027-02-29",
        "1900-02-29",
        "2030-04-31",
        "1899-12-31",
        "2030-1-01",
        "",
    ] {
        assert_eq!(
            common::request(
                &router,
                "POST",
                "/api/v1/projects",
                Some(json!({"name":"invalid", "due_date":date})),
                Some(&Uuid::new_v4().to_string())
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let key = Uuid::new_v4().to_string();
    let (_, first) = common::request(
        &router,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"A","due_date":"2030-01-15"})),
        Some(&key),
    )
    .await;
    common::request(
        &router,
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"B","due_date":"2028-02-29"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    let (_, list) = common::request(
        &router,
        "GET",
        "/api/v1/projects?sort=deadline&limit=1",
        None,
        None,
    )
    .await;
    assert_eq!(list["items"][0]["name"], "B");
    let (_, list) = common::request(
        &router,
        "GET",
        "/api/v1/projects?due_date=2030-01-15",
        None,
        None,
    )
    .await;
    assert_eq!(list["total"], 1);
    assert_eq!(
        common::request(
            &router,
            "GET",
            "/api/v1/projects?from=2030-02-01&to=2030-01-01",
            None,
            None
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"A","due_date":"2030-01-16"})),
            Some(&key)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let path = format!("/api/v1/projects/{}", first["id"].as_str().unwrap());
    let (_, unchanged) = common::request(
        &router,
        "PATCH",
        &path,
        Some(json!({"name":"A","expected_version":1})),
        None,
    )
    .await;
    assert_eq!(unchanged["version"], 1);
    let (status, archived) = common::request(
        &router,
        "PATCH",
        &path,
        Some(json!({"status":"archived","expected_version":1})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(archived["version"], 2);
    assert_eq!(
        common::request(
            &router,
            "DELETE",
            &path,
            Some(json!({"expected_version":1})),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, list) = common::request(
        &router,
        "GET",
        "/api/v1/projects?status=archived",
        None,
        None,
    )
    .await;
    assert_eq!(list["total"], 1);
    let (_, restored) = common::request(
        &router,
        "PATCH",
        &path,
        Some(json!({"status":"active","expected_version":2})),
        None,
    )
    .await;
    assert_eq!(restored["version"], 3);
    let (_, deleted) = common::request(
        &router,
        "DELETE",
        &path,
        Some(json!({"expected_version":3})),
        None,
    )
    .await;
    assert!(deleted["deleted_at"].is_i64());
    assert_eq!(
        common::request(
            &router,
            "DELETE",
            &path,
            Some(json!({"expected_version":3})),
            None
        )
        .await
        .1,
        deleted
    );
    assert_eq!(
        common::request(&router, "GET", &path, None, None).await.0,
        StatusCode::NOT_FOUND
    );
    // A creation retry cannot recreate a deleted resource.
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"A","due_date":"2030-01-15"})),
            Some(&key)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    let (_, list) = common::request(
        &app.router(),
        "GET",
        "/api/v1/projects?status=all",
        None,
        None,
    )
    .await;
    assert_eq!(list["total"], 1);
    app.shutdown().await.unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM projects", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
}
#[tokio::test]
async fn version_one_projects_and_receipts_survive_backed_up_migration() {
    let root = common::storage();
    std::fs::create_dir_all(root.path().join("db")).unwrap();
    let mut db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    let migration = refinery::Migration::unapplied(
        "V1__projects",
        include_str!("../migrations/V1__projects.sql"),
    )
    .unwrap();
    refinery::Runner::new(&[migration]).run(&mut db).unwrap();
    let id = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES (?1,'이전 프로젝트',1,1)",
        [&id],
    )
    .unwrap();
    db.execute(
        "INSERT INTO project_creation_requests VALUES (?1,'이전 프로젝트',?2)",
        [Uuid::new_v4().to_string(), id.clone()],
    )
    .unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let (_, list) = common::request(&app.router(), "GET", "/api/v1/projects", None, None).await;
    assert_eq!(list["items"][0]["id"], id);
    assert!(list["items"][0]["due_date"].is_null());
    app.shutdown().await.unwrap();
    let backups = std::fs::read_dir(root.path().join("backups"))
        .unwrap()
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
    assert_eq!(
        backup
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        backup
            .query_row("SELECT count(*) FROM project_creation_requests", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
    Application::open(root.path())
        .unwrap()
        .shutdown()
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_dir(root.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}
