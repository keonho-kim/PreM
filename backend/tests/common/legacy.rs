// Purpose: Exercise adoption using the released ledger and the V33–V36 schema differences.
// Pattern: Only disposable test databases receive historical metadata.
// Usage: Call after building a V1 fixture and before starting the application.
// Related: adapters/sqlite/migrations/legacy.rs, database_startup.rs.
use rusqlite::{Connection, params};

pub fn mark(db: &Connection, version: i32) {
    assert!((33..=36).contains(&version));
    db.execute_batch(
        "DROP TABLE IF EXISTS provider_diagnostics; DROP TABLE IF EXISTS provider_thinking;",
    )
    .unwrap();
    if version < 36 {
        db.execute_batch("DROP TABLE document_source_entries")
            .unwrap();
    }
    if version < 35 {
        db.execute_batch(
            "ALTER TABLE llm_provider_config_versions DROP COLUMN physical_batch_size;
            ALTER TABLE llm_provider_config_versions DROP COLUMN context_length",
        )
        .unwrap();
    }
    if version < 34 {
        db.execute_batch("DROP TABLE document_page_alignments; DROP TABLE document_alignment")
            .unwrap();
    }
    db.execute("DELETE FROM refinery_schema_history", [])
        .unwrap();
    for line in include_str!("../../src/adapters/sqlite/migrations/legacy-history.tsv")
        .lines()
        .take(version as usize)
    {
        let fields: Vec<_> = line.split('\t').collect();
        db.execute("INSERT INTO refinery_schema_history(version,name,applied_on,checksum) VALUES(?,?,'2026-01-01T00:00:00Z',?)",
            params![fields[0], fields[1], fields[2]]).unwrap();
    }
    db.pragma_update(None, "user_version", version).unwrap();
}
