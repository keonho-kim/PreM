// Purpose: Verify startup preserves storage and rejects incompatible or corrupt databases.
// Pattern: Real on-disk migration and restart tests with isolated data roots.
// Usage: cargo nextest run --test database_startup.
// Related: adapters/sqlite/migrations.rs, app/mod.rs.
#[path = "common/legacy.rs"]
mod legacy;
use prem_backend::app::Application;
use rusqlite::Connection;
use std::{fs, path::Path};
fn directory() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
    fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
#[tokio::test]
async fn exclusive_storage_lock_is_released_after_shutdown() {
    let root = directory();
    let app = Application::open(root.path()).unwrap();
    assert!(Application::open(root.path()).is_err());
    app.shutdown().await.unwrap();
    let app = Application::open(root.path()).unwrap();
    app.shutdown().await.unwrap();
}
#[tokio::test]
async fn newer_and_divergent_databases_are_rejected_without_reset() {
    let root = directory();
    Application::open(root.path())
        .unwrap()
        .shutdown()
        .await
        .unwrap();
    let path = root.path().join("db/app.sqlite");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("PRAGMA user_version=999").unwrap();
    drop(db);
    assert!(Application::open(root.path()).is_err());
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        999
    );
    db.execute_batch("PRAGMA user_version=1; UPDATE refinery_schema_history SET checksum='1'")
        .unwrap();
    drop(db);
    assert!(Application::open(root.path()).is_err());
    assert!(path.exists());
}
#[test]
fn corrupt_or_unrecognized_databases_are_not_initialized() {
    let root = directory();
    fs::create_dir_all(root.path().join("db")).unwrap();
    let path = root.path().join("db/app.sqlite");
    fs::write(&path, b"not a database").unwrap();
    assert!(Application::open(root.path()).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"not a database");
    fs::remove_file(&path).unwrap();
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve')",
    )
    .unwrap();
    drop(db);
    assert!(Application::open(root.path()).is_err());
    assert_eq!(
        Connection::open(&path)
            .unwrap()
            .query_row("SELECT value FROM unrelated", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "preserve"
    );
}
#[tokio::test]
async fn existing_empty_database_is_backed_up_before_migration() {
    let root = directory();
    fs::create_dir_all(root.path().join("db")).unwrap();
    let db = Connection::open(root.path().join("db/app.sqlite")).unwrap();
    db.execute_batch("PRAGMA user_version=0; VACUUM;").unwrap();
    drop(db);
    let app = Application::open(root.path()).unwrap();
    let backups = fs::read_dir(root.path().join("backups"))
        .unwrap()
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    app.shutdown().await.unwrap();
    let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
    assert_eq!(
        backup
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='projects'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[cfg(unix)]
#[test]
fn dangling_database_symlink_is_rejected_without_creating_its_target() {
    let root = directory();
    fs::create_dir_all(root.path().join("db")).unwrap();
    let outside = directory();
    let target = outside.path().join("must-not-create.sqlite");
    std::os::unix::fs::symlink(&target, root.path().join("db/app.sqlite")).unwrap();
    assert!(Application::open(root.path()).is_err());
    assert!(!target.exists());
}

#[tokio::test]
async fn repeated_shutdown_releases_storage_with_surviving_router_handles() {
    let root = directory();
    let mut retained_routers = Vec::new();
    for _ in 0..20 {
        let app = Application::open(root.path()).unwrap();
        retained_routers.push(app.router());
        app.shutdown().await.unwrap();
    }
    let reopened = Application::open(root.path()).unwrap();
    reopened.shutdown().await.unwrap();
    drop(retained_routers);
}

#[tokio::test]
async fn incompatible_legacy_databases_are_preserved() {
    for cause in ["checksum", "schema", "older"] {
        let dir = directory();
        Application::open(dir.path())
            .unwrap()
            .shutdown()
            .await
            .unwrap();
        let path = dir.path().join("db/app.sqlite");
        let db = Connection::open(&path).unwrap();
        legacy::mark(&db, 33);
        let (sql, reason, version) = match cause {
            "checksum" => (
                "UPDATE refinery_schema_history SET checksum='0' WHERE version=25",
                "modified legacy migration history",
                33,
            ),
            "schema" => (
                "DROP INDEX projects_updated",
                "differs from the V1 baseline",
                33,
            ),
            _ => (
                "DELETE FROM refinery_schema_history WHERE version=33; PRAGMA user_version=32",
                "upgrade to V36",
                32,
            ),
        };
        db.execute_batch(sql).unwrap();
        drop(db);
        let err = Application::open(dir.path())
            .err()
            .expect("should reject input");
        assert!(format!("{err:#}").contains(reason), "{err:#}");
        let db = Connection::open(path).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            version
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM refinery_schema_history", [], |r| r
                .get::<_, i32>(0))
                .unwrap(),
            version
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='document_alignment'",
                [],
                |r| r.get::<_, i32>(0)
            )
            .unwrap(),
            0
        );
    }
}
