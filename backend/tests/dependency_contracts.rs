// Purpose: Verify native DB, schema and streaming compatibility of foundational packages.
// Pattern: Integration contracts with isolated temporary storage and no external I/O.
// Usage: cargo test --workspace --locked --test dependency_contracts.
// Related: Cargo.toml, backend/Cargo.toml, dev-docs/08-dependencies.md.
use eventsource_stream::Eventsource;
use futures_util::{StreamExt, stream};
use rusqlite::{Connection, MAIN_DB};
use schemars::{JsonSchema, schema_for};
use serde::Deserialize;
use serde_json::json;
use std::{fs, io, path::Path, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

#[test]
fn bundled_sqlite_supports_migrations_fts_foreign_keys_and_backup() -> anyhow::Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
    fs::create_dir_all(&root)?;
    let directory = tempfile::Builder::new()
        .prefix("dependency-db-")
        .tempdir_in(root)?;
    let mut db = Connection::open(directory.path().join("probe.sqlite"))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let migrations = [refinery::Migration::unapplied(
        "V1__dependency_probe",
        "CREATE TABLE parents(id INTEGER PRIMARY KEY);
         CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
         CREATE VIRTUAL TABLE search_probe USING fts5(body);",
    )?];
    refinery::Runner::new(&migrations).run(&mut db)?;
    let repeated = refinery::Runner::new(&migrations).run(&mut db)?;
    assert!(repeated.applied_migrations().is_empty());
    assert!(
        db.execute("INSERT INTO children VALUES (1, 99)", [])
            .is_err()
    );
    db.execute("INSERT INTO parents VALUES (1)", [])?;
    db.execute("INSERT INTO children VALUES (1, 1)", [])?;
    db.execute("INSERT INTO search_probe VALUES ('document evidence')", [])?;
    let matches: i64 = db.query_row(
        "SELECT count(*) FROM search_probe WHERE search_probe MATCH 'evidence'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(matches, 1);
    let backup_path = directory.path().join("backup.sqlite");
    db.backup(
        MAIN_DB,
        &backup_path,
        None::<fn(rusqlite::backup::Progress)>,
    )?;
    let restored = Connection::open(backup_path)?;
    let count: i64 = restored.query_row("SELECT count(*) FROM children", [], |r| r.get(0))?;
    let integrity: String = restored.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    assert_eq!(count, 1);
    assert_eq!(integrity, "ok");
    Ok(())
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ToolInput {
    slide_id: String,
}

#[test]
fn generated_schemas_validate_locally_and_reject_external_retrieval() -> anyhow::Result<()> {
    let schema = serde_json::to_value(schema_for!(ToolInput))?;
    let validator = jsonschema::validator_for(&schema)?;
    let input = json!({"slide_id": "slide-1"});
    assert!(validator.is_valid(&input));
    assert!(!validator.is_valid(&json!({"slide_id": 12})));
    assert!(!validator.is_valid(&json!({"slide_id": "slide-1", "shell": "unexpected"})));
    let parsed: ToolInput = serde_json::from_value(input)?;
    assert_eq!(parsed.slide_id, "slide-1");
    for reference in [
        "https://example.invalid/schema.json",
        "file:///not-allowed.json",
    ] {
        assert!(jsonschema::validator_for(&json!({"$ref": reference})).is_err());
    }
    Ok(())
}

#[tokio::test]
async fn chunked_sse_preserves_utf8_and_owned_tasks_finish_on_cancellation() -> anyhow::Result<()> {
    let payload = "id: 7\ndata: 문서\ndata: 근거\n\n".as_bytes();
    let chunks = payload
        .chunks(2)
        .map(|chunk| Ok::<_, io::Error>(chunk.to_vec()));
    let events = stream::iter(chunks).eventsource().collect::<Vec<_>>().await;
    assert_eq!(events.len(), 1);
    let event = events[0].as_ref().expect("a complete SSE event");
    assert_eq!(event.id, "7");
    assert_eq!(event.data, "문서\n근거");

    let cancel = CancellationToken::new();
    let tracker = TaskTracker::new();
    let child = cancel.child_token();
    tracker.spawn(async move { child.cancelled().await });
    tracker.close();
    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(1), tracker.wait()).await?;
    assert!(tracker.is_empty());
    Ok(())
}
