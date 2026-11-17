-- Purpose: Register every document/template job with the common execution engine.
-- Pattern: Upload-trigger registration and checkpoints reference canonical extraction/decision rows.
-- Usage: Existing work is backfilled without rerunning extraction, OCR or model evaluation.
-- Related: documents/execution.rs, workflows/definitions/, V23 workflow tables.
CREATE TABLE document_workflows (
 job_id TEXT PRIMARY KEY REFERENCES document_jobs(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)
) STRICT;
INSERT INTO workflow_executions
 SELECT 'document:'||id,CASE WHEN template_version_id IS NULL THEN 'document' ELSE 'template' END,1,
 CASE WHEN template_version_id IS NULL THEN 'document-v1:extract@1>classify@1>ready@1' ELSE 'template-v1:extract@1>ready@1' END FROM document_jobs;
INSERT INTO document_workflows SELECT id,'document:'||id FROM document_jobs;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT 'document:'||j.id,'extract',1,0,CASE WHEN extraction_id IS NOT NULL OR EXISTS(SELECT 1 FROM template_import_links WHERE job_id=j.id) OR EXISTS(SELECT 1 FROM template_extractions WHERE id=j.id) THEN 'succeeded' ELSE 'pending' END FROM document_jobs j;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT 'document:'||j.id,'classify',1,1,CASE WHEN status='succeeded' OR (extraction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE p.extraction_id=j.extraction_id AND b.kind!='image' AND NOT EXISTS(SELECT 1 FROM document_decisions d WHERE d.job_id=j.id AND d.block_id=b.id))) THEN 'succeeded' ELSE 'pending' END FROM document_jobs j WHERE template_version_id IS NULL;
INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state)
 SELECT 'document:'||id,'ready',1,CASE WHEN template_version_id IS NULL THEN 2 ELSE 1 END,CASE WHEN status='succeeded' THEN 'succeeded' ELSE 'pending' END FROM document_jobs;
CREATE TRIGGER document_workflow_register AFTER INSERT ON document_jobs BEGIN
 INSERT INTO workflow_executions VALUES('document:'||new.id,CASE WHEN new.template_version_id IS NULL THEN 'document' ELSE 'template' END,1,CASE WHEN new.template_version_id IS NULL THEN 'document-v1:extract@1>classify@1>ready@1' ELSE 'template-v1:extract@1>ready@1' END);
 INSERT INTO document_workflows VALUES(new.id,'document:'||new.id);
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('document:'||new.id,'extract',1,0,'pending');
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) SELECT 'document:'||new.id,'classify',1,1,'pending' WHERE new.template_version_id IS NULL;
 INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES('document:'||new.id,'ready',1,CASE WHEN new.template_version_id IS NULL THEN 2 ELSE 1 END,'pending');
END;
CREATE TRIGGER document_workflow_interrupt AFTER UPDATE OF status ON document_jobs
WHEN new.status IN('failed','cancelled','waiting_configuration') AND old.status!=new.status BEGIN
 INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at)
 SELECT workflow_id,node_key,new.status,new.updated_at FROM workflow_nodes WHERE workflow_id='document:'||new.id AND state='running';
 UPDATE workflow_nodes SET state=CASE WHEN new.status='waiting_configuration' THEN 'pending' ELSE new.status END,lease=NULL,finished_at=new.updated_at WHERE workflow_id='document:'||new.id AND state='running';
END;
PRAGMA user_version=24;
