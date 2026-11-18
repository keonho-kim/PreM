// Purpose: Collect abandoned Blobs only before HTTP/workers start under the storage instance lock.
// Pattern: Two-observation seven-day grace, all FK references and local backup snapshots protected.
// Usage: Database startup invokes maintenance after migrations; ambiguity skips collection safely.
// Related: filesystem/collection.rs, V1__baseline.sql, migrations.rs.
use crate::adapters::filesystem::CollectionFiles;
use anyhow::ensure;
use rusqlite::{Connection, OpenFlags, params};
use std::{collections::BTreeSet, path::Path};
const RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn referenced(db: &Connection) -> anyhow::Result<BTreeSet<String>> {
    let mut hashes = BTreeSet::new();
    let tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for table in tables {
        let keys = db
            .prepare(&format!("PRAGMA foreign_key_list({})", quote(&table)))?
            .query_map([], |r| Ok((r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (target, column) in keys {
            if target == "file_blobs" {
                let sql = format!(
                    "SELECT DISTINCT {} FROM {} WHERE {} IS NOT NULL",
                    quote(&column),
                    quote(&table),
                    quote(&column)
                );
                hashes.extend(
                    db.prepare(&sql)?
                        .query_map([], |r| r.get::<_, String>(0))?
                        .collect::<Result<Vec<_>, _>>()?,
                );
            }
        }
    }
    Ok(hashes)
}
fn backups(root: &Path) -> anyhow::Result<BTreeSet<String>> {
    let mut hashes = BTreeSet::new();
    for file in std::fs::read_dir(root.join("backups"))? {
        let file = file?;
        // Unknown backup layout cannot be assumed to contain no references.
        ensure!(
            file.file_type()?.is_file() && file.path().extension().is_some_and(|e| e == "sqlite"),
            "unsupported backup layout; collection skipped"
        );
        // Backup API produces closed snapshots; immutable mode avoids creating WAL sidecars.
        // Reject any sidecar rather than reading an incomplete/external live backup.
        let path = file.path();
        let name = path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("invalid backup path"))?;
        ensure!(
            !Path::new(&format!("{name}-wal")).exists(),
            "live backup WAL; collection skipped"
        );
        let uri = format!(
            "file:{}?immutable=1",
            percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC)
        );
        let db = Connection::open_with_flags(
            uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )?;
        let integrity: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        ensure!(integrity == "ok", "backup integrity; collection skipped");
        let has_blobs: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='file_blobs')",
            [],
            |r| r.get(0),
        )?;
        if has_blobs {
            hashes.extend(
                db.prepare("SELECT sha256 FROM file_blobs")?
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }
    }
    Ok(hashes)
}
pub(super) fn run(db: &mut Connection, root: &Path) -> anyhow::Result<()> {
    let files = CollectionFiles::open(root)?;
    let mut candidates = files.inventory()?;
    candidates.extend(
        db.prepare("SELECT sha256 FROM file_blobs")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?,
    );
    let mut protected = referenced(db)?;
    protected.extend(backups(root)?);
    let now = crate::modules::documents::now();
    // Renew protection before considering deletion; a later orphan begins a fresh grace period.
    let tx = db.transaction()?;
    for hash in &protected {
        tx.execute(
            "DELETE FROM blob_collection_candidates WHERE sha256=?",
            [hash],
        )?;
    }
    for hash in candidates.difference(&protected) {
        tx.execute(
            "INSERT OR IGNORE INTO blob_collection_candidates VALUES(?,?)",
            params![hash, now],
        )?;
    }
    tx.commit()?;
    let expired = db.prepare("SELECT sha256 FROM blob_collection_candidates WHERE first_seen_at<=? ORDER BY first_seen_at,sha256 LIMIT 1000")?
        .query_map([now-RETENTION_MS],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
    if expired.is_empty() {
        return Ok(());
    }
    // Recheck immediately before deletion. No application writes or workers exist at this point.
    protected.extend(referenced(db)?);
    protected.extend(backups(root)?);
    let mut count = 0;
    let mut bytes = 0;
    for hash in expired {
        if protected.contains(&hash) {
            continue;
        }
        bytes += files.remove(&hash)?;
        let tx = db.transaction()?;
        tx.execute("DELETE FROM file_blobs WHERE sha256=?", [&hash])?;
        tx.execute(
            "DELETE FROM blob_collection_candidates WHERE sha256=?",
            [&hash],
        )?;
        tx.commit()?;
        count += 1;
    }
    tracing::info!(count, bytes, "Collected abandoned Blobs after retention");
    Ok(())
}
