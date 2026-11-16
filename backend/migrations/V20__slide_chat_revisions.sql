-- Purpose: Persist scoped conversational proposals and reuse unchanged slide versions on apply.
-- Pattern: Immutable base revisions, durable leased model work and explicit CAS publication.
-- Usage: Chat editing never overwrites an existing SlideSpec or changes unselected fields.
-- Related: modules/presentations/edits.rs, adapters/sqlite/presentations/edits/.
CREATE TABLE presentation_run_slides (
 run_id TEXT NOT NULL REFERENCES presentation_runs(id),slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),position INTEGER NOT NULL,
 PRIMARY KEY(run_id,position),UNIQUE(run_id,slide_version_id)
) STRICT;
INSERT INTO presentation_run_slides SELECT run_id,id,position FROM presentation_slide_versions;
CREATE TABLE presentation_edits (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 base_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),base_version INTEGER NOT NULL,
 source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),node_id TEXT NOT NULL REFERENCES outline_nodes(id),
 config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,
 prompt TEXT NOT NULL,fields_json TEXT NOT NULL,definition_version INTEGER NOT NULL CHECK(definition_version=1),runtime_profile TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','ready','applying','applied','failed','cancelled','rejected')),
 version INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,error_code TEXT,
 message TEXT,proposed_spec_sha256 TEXT REFERENCES file_blobs(sha256),request_id TEXT REFERENCES llm_requests(id),
 applied_run_id TEXT UNIQUE REFERENCES presentation_runs(id),created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX presentation_edits_queue ON presentation_edits(status,created_at,id);
CREATE INDEX presentation_edits_thread ON presentation_edits(project_id,presentation_id,node_id,created_at,id);
CREATE TABLE presentation_edit_commands (
 request_key TEXT PRIMARY KEY,edit_id TEXT NOT NULL REFERENCES presentation_edits(id),expected_version INTEGER NOT NULL,action TEXT NOT NULL
) STRICT;
CREATE TRIGGER project_edit_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE presentation_edits SET status='cancelled',version=version+1,lease=NULL,lease_until=NULL
 WHERE project_id=new.id AND status IN('queued','running','ready');
END;
PRAGMA user_version=20;
