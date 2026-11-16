-- Purpose: Persist reviewed generation inputs and resumable editable presentation production.
-- Pattern: Canonical evidence links, immutable designs/specs and lease-fenced publication.
-- Usage: Append-only after deployment; never rewrite existing source or outline revisions.
-- Related: modules/presentations/, adapters/sqlite/presentations/.
CREATE TABLE presentation_evidence_reviews (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
 outline_revision_id TEXT NOT NULL REFERENCES outline_revisions(id),fingerprint TEXT NOT NULL,
 created_at INTEGER NOT NULL,UNIQUE(project_id,fingerprint)
) STRICT;
CREATE TABLE presentation_evidence_links (
 review_id TEXT NOT NULL REFERENCES presentation_evidence_reviews(id),
 selection_id TEXT NOT NULL,selection_version INTEGER NOT NULL,
 PRIMARY KEY(review_id,selection_id),
 FOREIGN KEY(selection_id,selection_version) REFERENCES relation_link_changes(selection_id,version)
) STRICT;
CREATE TABLE presentation_designs (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
 evidence_review_id TEXT NOT NULL REFERENCES presentation_evidence_reviews(id),
 template_job_id TEXT REFERENCES document_jobs(id),created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE presentation_preparations (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),version INTEGER NOT NULL DEFAULT 0,
 design_id TEXT REFERENCES presentation_designs(id)
) STRICT;
CREATE TABLE presentations (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0,current_revision_id TEXT,created_at INTEGER NOT NULL,
 FOREIGN KEY(current_revision_id) REFERENCES presentation_revisions(id)
) STRICT;
CREATE TABLE presentation_runs (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,base_version INTEGER NOT NULL,
 design_id TEXT NOT NULL REFERENCES presentation_designs(id),config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),
 instructions TEXT NOT NULL,definition_version INTEGER NOT NULL CHECK(definition_version=1),runtime_profile TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 stage TEXT NOT NULL CHECK(stage IN('writing','rendering','complete')),
 version INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,
 error_code TEXT,created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX presentation_queue ON presentation_runs(status,created_at,id);
CREATE INDEX presentation_project_runs ON presentation_runs(project_id,created_at DESC,id);
CREATE TABLE presentation_slide_versions (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES presentation_runs(id),position INTEGER NOT NULL,
 node_id TEXT REFERENCES outline_nodes(id),spec_sha256 TEXT REFERENCES file_blobs(sha256),
 preview_sha256 TEXT REFERENCES file_blobs(sha256),request_id TEXT REFERENCES llm_requests(id),
 UNIQUE(run_id,position)
) STRICT;
CREATE TABLE presentation_slide_evidence (
 slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),
 block_id TEXT NOT NULL REFERENCES content_blocks(id),PRIMARY KEY(slide_version_id,block_id)
) STRICT;
CREATE TABLE presentation_revisions (
 id TEXT PRIMARY KEY REFERENCES presentation_runs(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 number INTEGER NOT NULL,output_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),created_at INTEGER NOT NULL,
 UNIQUE(presentation_id,number)
) STRICT;
CREATE TABLE presentation_revision_slides (
 revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),
 position INTEGER NOT NULL,PRIMARY KEY(revision_id,position),UNIQUE(revision_id,slide_version_id)
) STRICT;
CREATE TABLE presentation_commands (
 request_key TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES presentation_runs(id),expected_version INTEGER NOT NULL,action TEXT NOT NULL
) STRICT;
CREATE TRIGGER project_presentation_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE presentation_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1
 WHERE project_id=new.id AND status IN('queued','running');
END;
PRAGMA user_version=19;
