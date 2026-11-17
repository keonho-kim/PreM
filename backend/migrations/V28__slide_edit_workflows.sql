-- Purpose: Supervise AI proposal and actual preview rendering with durable engine nodes.
-- Pattern: Canonical edits and per-slide checkpoints retain ownership; approval remains explicit.
-- Usage: Reuse completed proposals/validated output after failure, cancellation and restart.
-- Related: presentation_edits, edits/execution.rs, SLIDE_EDIT definition.
CREATE TABLE slide_edit_workflows(edit_id TEXT PRIMARY KEY REFERENCES presentation_edits(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)) STRICT;
INSERT INTO workflow_executions SELECT 'edit:'||id,'slide_edit',1,'slide-edit-v1:propose@1>render@1' FROM presentation_edits;
INSERT INTO slide_edit_workflows SELECT id,'edit:'||id FROM presentation_edits;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'edit:'||e.id,'propose',1,0,CASE WHEN EXISTS(SELECT 1 FROM presentation_edit_targets t WHERE t.edit_id=e.id) AND NOT EXISTS(SELECT 1 FROM presentation_edit_targets t WHERE t.edit_id=e.id AND t.proposed_spec_sha256 IS NULL) THEN 'succeeded' ELSE 'pending' END FROM presentation_edits e;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'edit:'||e.id,'render',1,1,CASE WHEN EXISTS(SELECT 1 FROM presentation_edit_renders r WHERE r.edit_id=e.id) THEN 'succeeded' ELSE 'pending' END FROM presentation_edits e;
CREATE TRIGGER slide_edit_workflow_register AFTER INSERT ON presentation_edits BEGIN
 INSERT INTO workflow_executions VALUES('edit:'||new.id,'slide_edit',1,'slide-edit-v1:propose@1>render@1');
 INSERT INTO slide_edit_workflows VALUES(new.id,'edit:'||new.id);
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('edit:'||new.id,'propose',1,0,'pending'),('edit:'||new.id,'render',1,1,'pending');
END;
CREATE TRIGGER slide_edit_workflow_interrupt AFTER UPDATE OF status ON presentation_edits WHEN new.status IN('queued','failed','cancelled','rejected') AND new.status!=old.status BEGIN
 INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT workflow_id,node_key,new.status,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM workflow_nodes WHERE workflow_id='edit:'||new.id AND state='running';
 UPDATE workflow_nodes SET state=CASE WHEN new.status='queued' THEN 'pending' WHEN new.status='failed' THEN 'failed' ELSE 'cancelled' END,lease=NULL,finished_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE workflow_id='edit:'||new.id AND state='running';
END;
PRAGMA user_version=28;
