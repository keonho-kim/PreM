-- Purpose: Persist cross-project relation searches, reusable decisions and pinned selections.
-- Pattern: Canonical extraction/block references only; no copied document bodies or embeddings.
-- Usage: Append-only migration before the bounded search worker starts.
-- Related: modules/relations/, adapters/sqlite/relations/.
CREATE TABLE relation_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0,
 connection_id TEXT REFERENCES llm_provider_connections(id)
) STRICT;
INSERT INTO relation_settings(id) VALUES(1);
CREATE TABLE relation_runs (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, query TEXT NOT NULL,
 options_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
 guide_revision_id TEXT REFERENCES project_guide_revisions(id),
 config_id TEXT REFERENCES llm_provider_config_versions(id),
 definition_version INTEGER NOT NULL DEFAULT 1 CHECK(definition_version=1),
 status TEXT NOT NULL CHECK(status IN('queued','running','waiting_configuration','succeeded','failed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, attempt INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER, error_code TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX relation_runs_queue ON relation_runs(status,created_at,id);
CREATE INDEX relation_runs_project ON relation_runs(project_id,created_at DESC,id);
CREATE TABLE relation_sources (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 PRIMARY KEY(run_id,source_version_id)
) STRICT;
CREATE TABLE relation_assessments (
 cache_key TEXT PRIMARY KEY NOT NULL, context_hash TEXT NOT NULL,
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 block_id TEXT REFERENCES content_blocks(id),
 config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),
 definition_version INTEGER NOT NULL CHECK(definition_version=1),
 relation INTEGER NOT NULL CHECK(relation BETWEEN 0 AND 5),
 statistics_json TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES llm_requests(id),
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE relation_candidates (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES relation_runs(id),
 ordinal INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('file','block')),
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 block_id TEXT REFERENCES content_blocks(id), excerpt_block_id TEXT NOT NULL REFERENCES content_blocks(id),
 assessment_key TEXT REFERENCES relation_assessments(cache_key), cache_hit INTEGER NOT NULL DEFAULT 0 CHECK(cache_hit IN(0,1)),
 UNIQUE(run_id,ordinal), CHECK((kind='file' AND block_id IS NULL) OR (kind='block' AND block_id IS NOT NULL AND block_id=excerpt_block_id))
) STRICT;
CREATE UNIQUE INDEX relation_file_candidate_identity ON relation_candidates(run_id,extraction_id) WHERE kind='file';
CREATE UNIQUE INDEX relation_block_candidate_identity ON relation_candidates(run_id,block_id) WHERE kind='block';
CREATE TABLE relation_origins (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 PRIMARY KEY(candidate_id,source_version_id)
) STRICT;
CREATE TABLE relation_commands (
 request_key TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES relation_runs(id),
 expected_version INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN('retry','cancel'))
) STRICT;
CREATE TABLE relation_links (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL CHECK(active IN(0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE relation_link_changes (
 selection_id TEXT NOT NULL REFERENCES relation_links(id), version INTEGER NOT NULL,
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id), active INTEGER NOT NULL CHECK(active IN(0,1)),
 created_at INTEGER NOT NULL, PRIMARY KEY(selection_id,version)
) STRICT;
CREATE INDEX relation_links_project ON relation_links(project_id,active);
CREATE INDEX job_extraction_lookup ON document_jobs(extraction_id,source_version_id);
CREATE TRIGGER relation_project_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE relation_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1,updated_at=new.updated_at
 WHERE project_id=new.id AND status IN('queued','running','waiting_configuration');
END;
PRAGMA user_version=14;
