-- Purpose: Unify document and relation default decision selection without deleting legacy settings.
-- Pattern: Preserve historical rows; prefer the document default when both were configured.
-- Usage: Embedded forward migration with normal pre-migration backup.
-- Related: sqlite/decision_settings.rs, documents/, relations/.
CREATE TABLE decision_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    version INTEGER NOT NULL,
    connection_id TEXT REFERENCES llm_provider_connections(id)
);
INSERT INTO decision_settings(id,version,connection_id)
SELECT 1, max(d.version,r.version), coalesce(d.connection_id,r.connection_id)
FROM document_processing_settings d JOIN relation_settings r ON r.id=d.id WHERE d.id=1;

PRAGMA user_version=33;
