-- Purpose: Persist project outlines, canonical block assignments and resumable model proposals.
-- Pattern: Immutable revisions and node versions; CAS heads and leased checkpointed generation.
-- Usage: Embedded append-only migration; source/guide/model owners remain unchanged.
-- Related: modules/outlines/, project_source_reviews, content_blocks, llm_requests.
CREATE TABLE outline_heads (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), version INTEGER NOT NULL DEFAULT 0,
 current_revision_id TEXT,
 FOREIGN KEY(project_id,current_revision_id) REFERENCES outline_revisions(project_id,id)
) STRICT;
CREATE TABLE outline_revisions (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),number INTEGER NOT NULL,
 parent_revision_id TEXT REFERENCES outline_revisions(id),source_review_id TEXT NOT NULL REFERENCES project_source_reviews(id),
 guide_revision_id TEXT REFERENCES project_guide_revisions(id),origin TEXT NOT NULL CHECK(origin IN('manual','generate','map')),
 created_at INTEGER NOT NULL,UNIQUE(project_id,number),UNIQUE(project_id,id)
) STRICT;
CREATE TABLE outline_nodes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id)) STRICT;
CREATE TABLE outline_node_versions (
 id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES outline_nodes(id),title TEXT NOT NULL,description TEXT NOT NULL,
 UNIQUE(node_id,title,description),UNIQUE(node_id,id)
) STRICT;
CREATE TABLE outline_revision_nodes (
 revision_id TEXT NOT NULL REFERENCES outline_revisions(id),node_id TEXT NOT NULL REFERENCES outline_nodes(id),
 node_version_id TEXT NOT NULL,parent_node_id TEXT REFERENCES outline_nodes(id),position INTEGER NOT NULL,
 PRIMARY KEY(revision_id,node_id),UNIQUE(revision_id,position),
 FOREIGN KEY(node_id,node_version_id) REFERENCES outline_node_versions(node_id,id)
) STRICT;
CREATE TABLE outline_assignments (
 revision_id TEXT NOT NULL,node_id TEXT NOT NULL,block_id TEXT NOT NULL REFERENCES content_blocks(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 PRIMARY KEY(revision_id,node_id,block_id),
 FOREIGN KEY(revision_id,node_id) REFERENCES outline_revision_nodes(revision_id,node_id)
) STRICT;
CREATE TABLE outline_confirmations(revision_id TEXT PRIMARY KEY REFERENCES outline_revisions(id),created_at INTEGER NOT NULL) STRICT;
CREATE TABLE outline_runs (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('generate','map')),base_version INTEGER NOT NULL,
 source_review_id TEXT NOT NULL REFERENCES project_source_reviews(id),guide_revision_id TEXT REFERENCES project_guide_revisions(id),
 config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),scope_json TEXT NOT NULL,
 definition_version INTEGER NOT NULL DEFAULT 1 CHECK(definition_version=1),
 status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,
 error_code TEXT,result_revision_id TEXT REFERENCES outline_revisions(id),created_at INTEGER NOT NULL,
 UNIQUE(project_id,id)
) STRICT;
CREATE INDEX outline_runs_queue ON outline_runs(status,created_at,id);
CREATE INDEX outline_runs_project ON outline_runs(project_id,created_at DESC);
CREATE TABLE outline_run_blocks (
 run_id TEXT NOT NULL REFERENCES outline_runs(id),block_id TEXT NOT NULL REFERENCES content_blocks(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),ordinal INTEGER NOT NULL,batch INTEGER NOT NULL,
 PRIMARY KEY(run_id,block_id),UNIQUE(run_id,ordinal)
) STRICT;
CREATE TABLE outline_run_batches (
 run_id TEXT NOT NULL REFERENCES outline_runs(id),batch INTEGER NOT NULL,response_json TEXT,request_id TEXT REFERENCES llm_requests(id),
 PRIMARY KEY(run_id,batch)
) STRICT;
CREATE TABLE outline_run_commands(request_key TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES outline_runs(id),expected_version INTEGER NOT NULL,action TEXT NOT NULL) STRICT;
CREATE TRIGGER project_outline_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE outline_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1 WHERE project_id=new.id AND status IN('queued','running');
END;
PRAGMA user_version=17;
