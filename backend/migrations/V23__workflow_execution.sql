-- Purpose: Attach a versioned common execution graph to existing presentation jobs.
-- Pattern: Canonical job status stays in presentation_runs; engine owns node state/events/checkpoints.
-- Usage: Existing completed work is backfilled without regenerating specs or output bytes.
-- Related: workflows/engine/, sqlite/workflows.rs, presentations/execution.rs.
CREATE TABLE workflow_executions (
 id TEXT PRIMARY KEY,definition_key TEXT NOT NULL,definition_version INTEGER NOT NULL,definition_signature TEXT NOT NULL
) STRICT;
CREATE TABLE presentation_workflows (
 run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)
) STRICT;
CREATE TABLE workflow_nodes (
 workflow_id TEXT NOT NULL REFERENCES workflow_executions(id),node_key TEXT NOT NULL,node_version INTEGER NOT NULL,
 position INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','running','succeeded','failed','cancelled')),
 attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,started_at INTEGER,finished_at INTEGER,
 PRIMARY KEY(workflow_id,node_key),UNIQUE(workflow_id,position)
) STRICT;
CREATE TABLE workflow_events (
 id INTEGER PRIMARY KEY,workflow_id TEXT NOT NULL REFERENCES workflow_executions(id),node_key TEXT NOT NULL,
 event_type TEXT NOT NULL,created_at INTEGER NOT NULL,
 FOREIGN KEY(workflow_id,node_key) REFERENCES workflow_nodes(workflow_id,node_key)
) STRICT;
CREATE INDEX workflow_event_cursor ON workflow_events(workflow_id,id);
CREATE TABLE workflow_artifacts (
 workflow_id TEXT NOT NULL,node_key TEXT NOT NULL,role TEXT NOT NULL,position INTEGER NOT NULL,
 blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),PRIMARY KEY(workflow_id,node_key,role,position),
 FOREIGN KEY(workflow_id,node_key) REFERENCES workflow_nodes(workflow_id,node_key)
) STRICT;
INSERT INTO workflow_executions SELECT id,'presentation',1,'presentation-v1:write@1>render@1>publish@1' FROM presentation_runs;
INSERT INTO presentation_workflows SELECT id,id FROM presentation_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT id,'write',1,0,CASE WHEN status='succeeded' OR NOT EXISTS(SELECT 1 FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=presentation_runs.id AND s.spec_sha256 IS NULL) THEN 'succeeded' ELSE 'pending' END FROM presentation_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT id,'render',1,1,CASE WHEN status='succeeded' THEN 'succeeded' ELSE 'pending' END FROM presentation_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT id,'publish',1,2,CASE WHEN status='succeeded' THEN 'succeeded' ELSE 'pending' END FROM presentation_runs;
PRAGMA user_version=23;
