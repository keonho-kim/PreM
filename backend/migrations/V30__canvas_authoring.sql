-- Purpose: Support template-based manual decks and deterministic canvas commands without fake model/evidence rows.
-- Pattern: Backed-up table rebuild preserves all IDs; immutable manual designs pin actual template jobs.
-- Usage: Embedded migration before workers; existing generation and proposal histories remain readable.
-- Related: presentations/canvas.rs, manual.rs, V19/V20/V28 contracts.
DROP TRIGGER project_presentation_cancel;
DROP TRIGGER project_edit_cancel;
DROP TRIGGER slide_edit_workflow_register;
DROP TRIGGER slide_edit_workflow_interrupt;
CREATE TABLE presentation_manual_designs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),template_job_id TEXT REFERENCES document_jobs(id),created_at INTEGER NOT NULL) STRICT;
CREATE TABLE presentation_runs_next (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,base_version INTEGER NOT NULL,
 design_id TEXT REFERENCES presentation_designs(id),config_id TEXT REFERENCES llm_provider_config_versions(id),
 instructions TEXT NOT NULL,definition_version INTEGER NOT NULL CHECK(definition_version=1),runtime_profile TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 stage TEXT NOT NULL CHECK(stage IN('writing','rendering','complete')),
 version INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,
 error_code TEXT,created_at INTEGER NOT NULL,
 manual_design_id TEXT REFERENCES presentation_manual_designs(id),
 CHECK((design_id IS NOT NULL)!=(manual_design_id IS NOT NULL))
) STRICT;
INSERT INTO presentation_runs_next SELECT id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,version,attempt,lease,lease_until,error_code,created_at,NULL FROM presentation_runs;
DROP TABLE presentation_runs;
ALTER TABLE presentation_runs_next RENAME TO presentation_runs;
CREATE INDEX presentation_queue ON presentation_runs(status,created_at,id);
CREATE INDEX presentation_project_runs ON presentation_runs(project_id,created_at DESC,id);
CREATE TABLE presentation_edits_next (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 base_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),base_version INTEGER NOT NULL,
 source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),node_id TEXT REFERENCES outline_nodes(id),
 config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,
 prompt TEXT NOT NULL,fields_json TEXT NOT NULL,definition_version INTEGER NOT NULL CHECK(definition_version=1),runtime_profile TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','ready','applying','applied','failed','cancelled','rejected')),
 version INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,error_code TEXT,
 message TEXT,proposed_spec_sha256 TEXT REFERENCES file_blobs(sha256),request_id TEXT REFERENCES llm_requests(id),
 applied_run_id TEXT UNIQUE REFERENCES presentation_runs(id),created_at INTEGER NOT NULL
) STRICT;
INSERT INTO presentation_edits_next SELECT * FROM presentation_edits;
DROP TABLE presentation_edits;
ALTER TABLE presentation_edits_next RENAME TO presentation_edits;
CREATE INDEX presentation_edits_queue ON presentation_edits(status,created_at,id);
CREATE INDEX presentation_edits_thread ON presentation_edits(project_id,presentation_id,node_id,created_at,id);
CREATE TRIGGER project_presentation_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE presentation_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1
 WHERE project_id=new.id AND status IN('queued','running');
END;
CREATE TRIGGER project_edit_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE presentation_edits SET status='cancelled',version=version+1,lease=NULL,lease_until=NULL
 WHERE project_id=new.id AND status IN('queued','running','ready');
END;
CREATE TRIGGER slide_edit_workflow_register AFTER INSERT ON presentation_edits BEGIN
 INSERT INTO workflow_executions VALUES('edit:'||new.id,'slide_edit',1,'slide-edit-v1:propose@1>render@1');
 INSERT INTO slide_edit_workflows VALUES(new.id,'edit:'||new.id);
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('edit:'||new.id,'propose',1,0,'pending'),('edit:'||new.id,'render',1,1,'pending');
END;
CREATE TRIGGER slide_edit_workflow_interrupt AFTER UPDATE OF status ON presentation_edits WHEN new.status IN('queued','failed','cancelled','rejected') AND new.status!=old.status BEGIN
 INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT workflow_id,node_key,new.status,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM workflow_nodes WHERE workflow_id='edit:'||new.id AND state='running';
 UPDATE workflow_nodes SET state=CASE WHEN new.status='queued' THEN 'pending' WHEN new.status='failed' THEN 'failed' ELSE 'cancelled' END,lease=NULL,finished_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE workflow_id='edit:'||new.id AND state='running';
END;

CREATE TABLE presentation_canvas_commands(run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),base_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),operation TEXT NOT NULL) STRICT;
CREATE TEMP TABLE migration_fk_guard(errors INTEGER CHECK(errors=0));
INSERT INTO migration_fk_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_guard;
PRAGMA user_version=30;
