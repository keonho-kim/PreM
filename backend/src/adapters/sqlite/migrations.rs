// Purpose: Open a verified database and apply backed-up append-only migrations.
// Pattern: Read-only preflight before any existing database mutation.
// Usage: Called once before starting the owned SQLite thread.
// Related: backend/migrations/, app/mod.rs, sqlite/mod.rs.
use anyhow::{Context, ensure};
use rusqlite::{Connection, MAIN_DB, OpenFlags};
use std::{
    fs::{self, File},
    path::Path,
    time::Duration,
};
use uuid::Uuid;
mod embedded {
    refinery::embed_migrations!("migrations");
}

pub(super) fn open(root: &Path) -> anyhow::Result<Connection> {
    let path = root.join("db/app.sqlite");
    let runner = embedded::migrations::runner();
    let latest = runner
        .get_migrations()
        .iter()
        .map(|m| m.version())
        .max()
        .unwrap_or(0);
    let existing = match fs::symlink_metadata(&path) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(metadata) = existing {
        ensure!(
            metadata.is_file() && !metadata.file_type().is_symlink(),
            "database must be a regular file, not a symlink"
        );
        ensure!(
            metadata.len() > 0,
            "existing database is empty; explicit recovery required"
        );
        let mut source = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        verify_integrity(&source)?;
        let version: i32 = source.pragma_query_value(None, "user_version", |row| row.get(0))?;
        ensure!(version <= latest, "database is newer than this application");
        let has_history: bool = source.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='refinery_schema_history')",
            [],
            |r| r.get(0),
        )?;
        if has_history {
            let app_id: i32 = source.pragma_query_value(None, "application_id", |r| r.get(0))?;
            ensure!(app_id == 1347768408, "database identity mismatch");
            let applied = runner.get_applied_migrations(&mut source)?;
            for migration in &applied {
                ensure!(
                    runner
                        .get_migrations()
                        .iter()
                        .any(|m| m.version() == migration.version()
                            && m.name() == migration.name()
                            && m.checksum() == migration.checksum()),
                    "unsupported or modified migration history"
                );
            }
            ensure!(
                applied.len() == usize::try_from(version)?,
                "inconsistent database schema version"
            );
        } else {
            let tables: i64 = source.query_row("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0))?;
            ensure!(
                version == 0 && tables == 0,
                "unrecognized database; refusing initialization"
            );
        }
        if version < latest {
            let backup = root
                .join("backups")
                .join(format!("before-migration-{}.sqlite", Uuid::new_v4()));
            source.backup(MAIN_DB, &backup, None::<fn(rusqlite::backup::Progress)>)?;
            File::open(backup)?.sync_all()?;
        }
    }
    let mut connection = Connection::open(path).context("could not open application database")?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
    )?;
    // SQLite's supported table-rebuild procedure requires disabling FK actions before BEGIN.
    // Rebuild migrations check constraints inside the transaction; clients reopen with FK enforcement.
    connection.pragma_update(None, "foreign_keys", false)?;
    runner
        .set_grouped(true)
        .set_abort_divergent(true)
        .set_abort_missing(true)
        .run(&mut connection)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    verify_integrity(&connection)?;
    connection.prepare("SELECT id,name,version,created_at,updated_at,due_date,status,deleted_at FROM projects LIMIT 0")?;
    connection.prepare(
        "SELECT request_key,original_name,original_due_date,project_id FROM project_creation_requests LIMIT 0",
    )?;
    ensure!(
        !connection
            .prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_some(),
        "database foreign key integrity failed"
    );
    Ok(connection)
}
fn verify_integrity(connection: &Connection) -> anyhow::Result<()> {
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    ensure!(
        result == "ok",
        "database integrity failed; explicit recovery required"
    );
    Ok(())
}
