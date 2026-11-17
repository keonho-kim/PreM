-- Purpose: Attach durable related-material discovery to the common execution engine.
-- Pattern: Candidate admission is atomic; exploration and result publication have separate checkpoints.
-- Usage: Preserve existing candidates, decisions, planner pins and bounded search workspaces.
-- Related: V14/V18 relation tables, sqlite/relations/execution.rs.
CREATE TABLE relation_workflows(run_id TEXT PRIMARY KEY REFERENCES relation_runs(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)) STRICT;
INSERT INTO workflow_executions SELECT 'relation:'||id,'relation',1,'relation-v1:retrieve@1>review@1>publish@1' FROM relation_runs;
INSERT INTO relation_workflows SELECT id,'relation:'||id FROM relation_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'relation:'||id,'retrieve',1,0,'succeeded' FROM relation_runs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'relation:'||r.id,'review',1,1,CASE WHEN status='succeeded' OR EXISTS(SELECT 1 FROM relation_workspaces w WHERE w.run_id=r.id AND w.phase='complete') THEN 'succeeded' ELSE 'pending' END FROM relation_runs r;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'relation:'||id,'publish',1,2,CASE WHEN status='succeeded' THEN 'succeeded' ELSE 'pending' END FROM relation_runs;
CREATE TRIGGER relation_workflow_register AFTER INSERT ON relation_runs BEGIN
 INSERT INTO workflow_executions VALUES('relation:'||new.id,'relation',1,'relation-v1:retrieve@1>review@1>publish@1');
 INSERT INTO relation_workflows VALUES(new.id,'relation:'||new.id);
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('relation:'||new.id,'retrieve',1,0,'succeeded'),('relation:'||new.id,'review',1,1,'pending'),('relation:'||new.id,'publish',1,2,'pending');
END;
CREATE TRIGGER relation_workflow_interrupt AFTER UPDATE OF status ON relation_runs
WHEN new.status IN('queued','failed','cancelled','waiting_configuration') AND old.status!=new.status BEGIN
 INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) SELECT workflow_id,node_key,new.status,new.updated_at FROM workflow_nodes WHERE workflow_id='relation:'||new.id AND state='running';
 UPDATE workflow_nodes SET state=CASE WHEN new.status IN('queued','waiting_configuration') THEN 'pending' ELSE new.status END,lease=NULL,finished_at=new.updated_at WHERE workflow_id='relation:'||new.id AND state='running';
END;
PRAGMA user_version=26;
