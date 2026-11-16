-- Purpose: Add project-scoped immutable originals and bind them to the existing document engine.
-- Pattern: Guarded table rebuild preserves job IDs, receipts, references and all prior results.
-- Usage: Startup migration runs with FK enforcement restored and checks inside this transaction.
-- Related: libraries/, documents/, studio/, migrations.rs.
CREATE TABLE source_items (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
 version INTEGER NOT NULL DEFAULT 1, current_version_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 FOREIGN KEY(id,current_version_id) REFERENCES source_versions(item_id,id)
) STRICT;
CREATE TABLE source_versions (
 id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES source_items(id),
 number INTEGER NOT NULL CHECK(number>0), file_registration_id TEXT NOT NULL REFERENCES file_registrations(id),
 created_at INTEGER NOT NULL, UNIQUE(item_id,number), UNIQUE(item_id,id)
) STRICT;
CREATE INDEX source_project ON source_items(project_id,deleted_at,updated_at);
CREATE TABLE document_jobs_next (
 id TEXT PRIMARY KEY NOT NULL, reference_version_id TEXT REFERENCES reference_versions(id),
 template_version_id TEXT REFERENCES template_versions(id), source_version_id TEXT REFERENCES source_versions(id), request_key TEXT UNIQUE NOT NULL,
 request_fingerprint TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL, definition_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN('queued','extracting','classifying','waiting_configuration','succeeded','failed','cancelled')),
 generation INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, attempt INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER, retry_at INTEGER NOT NULL DEFAULT 0,
 extraction_id TEXT REFERENCES document_extractions(id), config_id TEXT REFERENCES llm_provider_config_versions(id),
 error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((reference_version_id IS NOT NULL)+(template_version_id IS NOT NULL)+(source_version_id IS NOT NULL)=1)
) STRICT;
CREATE TABLE upload_requests_next (
 request_key TEXT PRIMARY KEY NOT NULL,
 kind TEXT CHECK(kind IN ('reference','template','source')), target_id TEXT, expected_version INTEGER,
 attempt TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','failed','cancelled','complete')),
 fingerprint TEXT, reference_version_id TEXT REFERENCES reference_versions(id),
 template_version_id TEXT REFERENCES template_versions(id), source_version_id TEXT REFERENCES source_versions(id), project_id TEXT REFERENCES projects(id), created_at INTEGER NOT NULL,
 CHECK(state!='complete' OR ((reference_version_id IS NOT NULL)+(template_version_id IS NOT NULL)+(source_version_id IS NOT NULL)=1))
) STRICT;
INSERT INTO document_jobs_next(id,reference_version_id,template_version_id,request_key,request_fingerprint,profile,definition_version,status,generation,version,attempt,lease,lease_until,retry_at,extraction_id,config_id,error_code,created_at,updated_at) SELECT id,reference_version_id,template_version_id,request_key,request_fingerprint,profile,definition_version,status,generation,version,attempt,lease,lease_until,retry_at,extraction_id,config_id,error_code,created_at,updated_at FROM document_jobs;
INSERT INTO upload_requests_next(request_key,kind,target_id,expected_version,attempt,state,fingerprint,reference_version_id,template_version_id,created_at) SELECT request_key,kind,target_id,expected_version,attempt,state,fingerprint,reference_version_id,template_version_id,created_at FROM upload_requests;
DROP TRIGGER reference_document_job;
DROP TRIGGER template_document_job;
DROP TRIGGER reference_document_cancel;
DROP TRIGGER template_document_cancel;
DROP TABLE document_jobs;
ALTER TABLE document_jobs_next RENAME TO document_jobs;
DROP TABLE upload_requests;
ALTER TABLE upload_requests_next RENAME TO upload_requests;
CREATE INDEX document_jobs_ready ON document_jobs(status,retry_at,created_at);
CREATE INDEX document_jobs_reference ON document_jobs(reference_version_id,created_at DESC,id);
CREATE INDEX document_jobs_template ON document_jobs(template_version_id,created_at DESC,id);
CREATE TRIGGER reference_document_job AFTER INSERT ON reference_versions BEGIN
 INSERT INTO document_jobs(id,reference_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;
CREATE TRIGGER template_document_job AFTER INSERT ON template_versions BEGIN
 INSERT INTO document_jobs(id,template_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;
CREATE UNIQUE INDEX document_reference_generation ON document_jobs(reference_version_id,generation);
CREATE UNIQUE INDEX document_template_generation ON document_jobs(template_version_id,generation);
CREATE TRIGGER reference_document_cancel AFTER UPDATE OF deleted_at ON reference_items
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 INSERT INTO document_job_events(job_id,status,created_at)
 SELECT j.id,'cancelled',new.updated_at FROM document_jobs j JOIN reference_versions v ON v.id=j.reference_version_id WHERE v.item_id=new.id AND j.status IN('queued','extracting','classifying','waiting_configuration');
 UPDATE document_jobs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1,updated_at=new.updated_at WHERE reference_version_id IN(SELECT id FROM reference_versions WHERE item_id=new.id) AND status IN('queued','extracting','classifying','waiting_configuration');
END;
CREATE TRIGGER template_document_cancel AFTER UPDATE OF deleted_at ON template_items
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 INSERT INTO document_job_events(job_id,status,created_at)
 SELECT j.id,'cancelled',new.updated_at FROM document_jobs j JOIN template_versions v ON v.id=j.template_version_id WHERE v.item_id=new.id AND j.status IN('queued','extracting','classifying','waiting_configuration');
 UPDATE document_jobs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1,updated_at=new.updated_at WHERE template_version_id IN(SELECT id FROM template_versions WHERE item_id=new.id) AND status IN('queued','extracting','classifying','waiting_configuration');
END;

CREATE UNIQUE INDEX document_source_generation ON document_jobs(source_version_id,generation);
CREATE TRIGGER source_document_job AFTER INSERT ON source_versions BEGIN
 INSERT INTO document_jobs(id,source_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;
CREATE TRIGGER source_document_cancel AFTER UPDATE OF deleted_at ON source_items
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 INSERT INTO document_job_events(job_id,status,created_at) SELECT j.id,'cancelled',new.updated_at FROM document_jobs j JOIN source_versions v ON v.id=j.source_version_id WHERE v.item_id=new.id AND j.status IN('queued','extracting','classifying','waiting_configuration');
 UPDATE document_jobs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1,updated_at=new.updated_at
 WHERE source_version_id IN(SELECT id FROM source_versions WHERE item_id=new.id)
 AND status IN('queued','extracting','classifying','waiting_configuration');
END;
CREATE TRIGGER project_source_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE source_items SET deleted_at=new.deleted_at,version=version+1,updated_at=new.updated_at WHERE project_id=new.id AND deleted_at IS NULL;
END;
CREATE TABLE project_source_reviews (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 snapshot_hash TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project_id,snapshot_hash)
) STRICT;
CREATE TABLE project_source_review_files (
 review_id TEXT NOT NULL REFERENCES project_source_reviews(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 PRIMARY KEY(review_id,source_version_id)
) STRICT;
CREATE TABLE project_guide_revisions (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 parent_revision_id TEXT REFERENCES project_guide_revisions(id), version INTEGER NOT NULL,
 do_text TEXT NOT NULL, dont_text TEXT NOT NULL, created_at INTEGER NOT NULL,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
 UNIQUE(project_id,version)
) STRICT;
CREATE TEMP TABLE migration_fk_guard(errors INTEGER CHECK(errors=0));
INSERT INTO migration_fk_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_guard;
PRAGMA user_version=13;
