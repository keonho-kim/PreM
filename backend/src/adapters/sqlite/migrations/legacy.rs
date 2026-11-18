// Purpose: Adopt databases on the final compatible releases into the new baseline.
// Pattern: Verify the historical ledger, complete additive DDL and replace only the ledger atomically.
// Usage: Called under the instance lock after read-only preflight and an online backup.
// Related: migrations.rs, legacy-history.tsv, backend/migrations/V1__baseline.sql.
use anyhow::{Context, ensure};
use rusqlite::{Connection, params};
use std::collections::BTreeMap;

const HISTORY: &str = include_str!("legacy-history.tsv");

pub(super) fn verify(version: i32, applied: &[refinery::Migration]) -> anyhow::Result<()> {
    ensure!(
        (1..=36).contains(&version),
        "unsupported legacy database version"
    );
    let expected = HISTORY.lines().take(usize::try_from(version)?);
    ensure!(
        applied.len() == expected.clone().count(),
        "incomplete legacy migration history"
    );
    for (migration, line) in applied.iter().zip(expected) {
        ensure!(
            format!(
                "{}\t{}\t{}",
                migration.version(),
                migration.name(),
                migration.checksum()
            ) == line,
            "unsupported or modified legacy migration history"
        );
    }
    ensure!(
        version >= 33,
        "legacy database V{version}: upgrade to V36 with PreM revision d196e23 first (see backend/migrations/README.md)"
    );
    Ok(())
}

fn schema(db: &Connection) -> rusqlite::Result<BTreeMap<(String, String), String>> {
    db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name != 'refinery_schema_history' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow')")?
        .query_map([], |r| Ok(((r.get(0)?,r.get(1)?),r.get(2)?)))?.collect()
}

pub(super) fn adopt(db: &mut Connection, version: i32) -> anyhow::Result<()> {
    let mut reference = Connection::open_in_memory()?;
    super::embedded::migrations::runner()
        .set_target(refinery::Target::Version(1))
        .run(&mut reference)?;
    let expected = schema(&reference)?;
    let tx = db.transaction()?;
    // Only these additive differences separate V33–V35 from the deployed V36 schema.
    let create_table = |name: &str| -> anyhow::Result<()> {
        let ddl = expected
            .get(&("table".into(), name.into()))
            .context("missing baseline table")?;
        tx.execute_batch(ddl)?;
        Ok(())
    };
    if version < 34 {
        create_table("document_alignment")?;
        create_table("document_page_alignments")?;
    }
    if version < 35 {
        tx.execute_batch("ALTER TABLE llm_provider_config_versions ADD COLUMN context_length INTEGER CHECK(context_length BETWEEN 1 AND 2147483647);
            ALTER TABLE llm_provider_config_versions ADD COLUMN physical_batch_size INTEGER CHECK(physical_batch_size BETWEEN 1 AND 2147483647);")?;
    }
    if version < 36 {
        create_table("document_source_entries")?;
    }
    ensure!(
        schema(&tx)? == expected,
        "legacy schema differs from the V1 baseline; database not adopted"
    );
    super::verify_foreign_keys(&tx)?;
    let (name, applied_on, checksum): (String, String, String) = reference.query_row(
        "SELECT name,applied_on,checksum FROM refinery_schema_history WHERE version=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    tx.execute("DELETE FROM refinery_schema_history", [])?;
    tx.execute(
        "INSERT INTO refinery_schema_history(version,name,applied_on,checksum) VALUES(1,?,?,?)",
        params![name, applied_on, checksum],
    )?;
    tx.pragma_update(None, "user_version", 1)?;
    tx.commit()?;
    Ok(())
}
