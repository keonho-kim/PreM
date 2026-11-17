-- Purpose: Attach canonical outline generation/mapping jobs to the common execution engine.
-- Pattern: Immutable batch outputs remain canonical; admission and interruption register atomically.
-- Usage: Backfill prior jobs without rewriting source blocks, revisions or model results.
-- Related: V17 outline tables, V23 engine tables, sqlite/outlines/execution.rs.
CREATE TABLE outline_workflows (
 run_id TEXT PRIMARY KEY REFERENCES outline_runs(id),
 workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)
) STRICT;
INSERT INTO workflow_executions
 SELECT 'outline:'||id,CASE kind WHEN 'map' THEN 'mapping' ELSE 'outline' END,1,
 CASE kind WHEN 'map' THEN 'mapping-v1:map@1>publish@1' ELSE 'outline-v1:compose@1>publish@1' END FROM outline_runs;
INSERT INTO outline_workflows SELECT id,'outline:'||id FROM outline_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT 'outline:'||r.id,CASE kind WHEN 'map' THEN 'map' ELSE 'compose' END,1,0,
 CASE WHEN status='succeeded' OR (EXISTS(SELECT 1 FROM outline_run_batches b WHERE b.run_id=r.id) AND NOT EXISTS(SELECT 1 FROM outline_run_batches b WHERE b.run_id=r.id AND response_json IS NULL)) THEN 'succeeded' ELSE 'pending' END FROM outline_runs r;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT 'outline:'||id,'publish',1,1,CASE WHEN status='succeeded' THEN 'succeeded' ELSE 'pending' END FROM outline_runs;
CREATE TRIGGER outline_workflow_register AFTER INSERT ON outline_runs BEGIN
 INSERT INTO workflow_executions VALUES('outline:'||new.id,CASE new.kind WHEN 'map' THEN 'mapping' ELSE 'outline' END,1,CASE new.kind WHEN 'map' THEN 'mapping-v1:map@1>publish@1' ELSE 'outline-v1:compose@1>publish@1' END);
 INSERT INTO outline_workflows VALUES(new.id,'outline:'||new.id);
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('outline:'||new.id,CASE new.kind WHEN 'map' THEN 'map' ELSE 'compose' END,1,0,'pending');
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('outline:'||new.id,'publish',1,1,'pending');
END;
CREATE TRIGGER outline_workflow_interrupt AFTER UPDATE OF status ON outline_runs
WHEN new.status IN('queued','failed','cancelled') AND old.status!=new.status BEGIN
 INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at)
 SELECT workflow_id,node_key,new.status,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM workflow_nodes WHERE workflow_id='outline:'||new.id AND state='running';
 UPDATE workflow_nodes SET state=CASE WHEN new.status='queued' THEN 'pending' ELSE new.status END,lease=NULL,finished_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE workflow_id='outline:'||new.id AND state='running';
END;
PRAGMA user_version=25;
