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
mod legacy;
mod embedded {
    refinery::embed_migrations!("migrations");
}

pub(super) fn open(root: &Path) -> anyhow::Result<Connection> {
    open_with(root, embedded::migrations::runner())
}

fn open_with(root: &Path, runner: refinery::Runner) -> anyhow::Result<Connection> {
    let path = root.join("db/app.sqlite");
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
    let mut legacy_version = None;
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
        let has_history: bool = source.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='refinery_schema_history')",
            [],
            |r| r.get(0),
        )?;
        if has_history {
            let app_id: i32 = source.pragma_query_value(None, "application_id", |r| r.get(0))?;
            ensure!(app_id == 1347768408, "database identity mismatch");
            let applied = runner.get_applied_migrations(&mut source)?;
            if applied
                .first()
                .is_some_and(|m| m.version() == 1 && m.name() == "projects")
            {
                legacy::verify(version, &applied)?;
                legacy_version = Some(version);
            } else {
                ensure!(version <= latest, "database is newer than this application");
                ensure!(
                    version > 0 && applied.len() == usize::try_from(version)?,
                    "inconsistent database schema version"
                );
                for (index, migration) in applied.iter().enumerate() {
                    ensure!(
                        usize::try_from(migration.version())? == index + 1
                            && runner
                                .get_migrations()
                                .iter()
                                .any(|expected| migration.version() == expected.version()
                                    && migration.name() == expected.name()
                                    && migration.checksum() == expected.checksum()),
                        "unsupported or modified migration history"
                    );
                }
            }
        } else {
            let tables: i64 = source.query_row("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0))?;
            ensure!(
                version == 0 && tables == 0,
                "unrecognized database; refusing initialization"
            );
        }
        if legacy_version.is_some() || version < latest {
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
    if let Some(version) = legacy_version {
        legacy::adopt(&mut connection, version)?;
    }
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
    verify_foreign_keys(&connection)?;
    Ok(connection)
}

fn verify_foreign_keys(connection: &Connection) -> anyhow::Result<()> {
    ensure!(
        connection
            .prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_none(),
        "database foreign key integrity failed"
    );
    Ok(())
}
fn verify_integrity(connection: &Connection) -> anyhow::Result<()> {
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    ensure!(
        result == "ok",
        "database integrity failed; explicit recovery required"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn next_migration_runs_once_on_top_of_the_baseline() {
        let artifacts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/.artifacts");
        fs::create_dir_all(&artifacts).unwrap();
        let dir = tempfile::tempdir_in(artifacts).unwrap();
        let root = dir.path();
        fs::create_dir(root.join("db")).unwrap();
        fs::create_dir(root.join("backups")).unwrap();
        let baseline = embedded::migrations::runner()
            .get_migrations()
            .iter()
            .find(|m| m.version() == 1)
            .unwrap()
            .clone();
        let second = refinery::Migration::unapplied(
            "V2__probe",
            "CREATE TABLE upgrade_probe(id INTEGER PRIMARY KEY); PRAGMA user_version=2;",
        )
        .unwrap();
        let migrations = [baseline, second];
        drop(open_with(root, refinery::Runner::new(&migrations[..1])).unwrap());
        for _ in 0..2 {
            let db = open_with(root, refinery::Runner::new(&migrations)).unwrap();
            assert_eq!(
                db.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                    .unwrap(),
                2
            );
            assert_eq!(
                db.query_row("SELECT count(*) FROM refinery_schema_history", [], |row| {
                    row.get::<_, i32>(0)
                })
                .unwrap(),
                2
            );
        }
        assert_eq!(fs::read_dir(root.join("backups")).unwrap().count(), 1);
    }
}
