// Purpose: Verify one deadline survives V2 migration with its original request receipt.
// Pattern: On-disk old-schema fixture, HTTP compatibility and physical schema assertions.
// Usage: cargo nextest run --test project_due_migration.
// Related: migrations/V3__project_due_date.sql, adapters/http/projects.rs.
mod common;
use axum::http::StatusCode;
use prem_backend::app::Application;
use rusqlite::{Connection, params};
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn deadline_rename_preserves_values_revisions_and_retries() {
    let root = common::storage();
    std::fs::create_dir_all(root.path().join("db")).unwrap();
    let path = root.path().join("db/app.sqlite");
    let mut db = Connection::open(&path).unwrap();
    let migrations = [
        refinery::Migration::unapplied(
            "V1__projects",
            include_str!("../migrations/V1__projects.sql"),
        )
        .unwrap(),
        refinery::Migration::unapplied(
            "V2__project_home",
            include_str!("../migrations/V2__project_home.sql"),
        )
        .unwrap(),
    ];
    refinery::Runner::new(&migrations).run(&mut db).unwrap();
    let id = Uuid::new_v4().to_string();
    let key = Uuid::new_v4().to_string();
    db.execute("INSERT INTO projects(id,name,status,version,created_at,updated_at,end_date) VALUES (?1,'마감일 보존','archived',7,1,2,'2030-01-15')",[&id]).unwrap();
    db.execute("INSERT INTO project_creation_requests(request_key,original_name,project_id,original_end_date) VALUES (?1,'마감일 보존',?2,'2030-01-15')",params![key,id]).unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let router = app.router();
    let (_, list) = common::request(
        &router,
        "GET",
        "/api/v1/projects?status=all&due_date=2030-01-15",
        None,
        None,
    )
    .await;
    assert_eq!(list["total"], 1);
    assert_eq!(list["items"][0]["due_date"], "2030-01-15");
    assert_eq!(list["items"][0]["version"], 7);
    assert_eq!(list["items"][0]["status"], "archived");
    for field in ["due_date", "end_date"] {
        let (status, replayed) = common::request(
            &router,
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"마감일 보존",field:"2030-01-15"})),
            Some(&key),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(replayed["id"], id);
        assert_eq!(replayed["due_date"], replayed["end_date"]);
    }
    let (_, empty) = common::request(
        &router,
        "GET",
        "/api/v1/projects?status=all&due_date=2030-01-16",
        None,
        None,
    )
    .await;
    assert_eq!(empty["total"], 0);
    assert_eq!(
        common::request(
            &router,
            "GET",
            "/api/v1/projects?due_date=2030-02-30",
            None,
            None
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    app.shutdown().await.unwrap();
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        36
    );
    let mut columns = db
        .prepare("SELECT name FROM pragma_table_info('projects')")
        .unwrap();
    let columns = columns
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(columns.contains(&"due_date".to_owned()));
    assert!(!columns.iter().any(|c| c == "end_date" || c == "start_date"));
    let backup = std::fs::read_dir(root.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let backup = Connection::open(backup).unwrap();
    assert_eq!(
        backup
            .query_row("SELECT end_date FROM projects", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "2030-01-15"
    );
    Application::open(root.path())
        .unwrap()
        .shutdown()
        .await
        .unwrap();
}
