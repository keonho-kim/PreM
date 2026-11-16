-- Purpose: Persist document extraction checkpoints, immutable blocks and explicit decision results.
-- Pattern: Version-scoped jobs, short leased writes and append-only result lineage.
-- Usage: Embedded refinery migration before processing workers start.
-- Related: modules/documents/, adapters/sqlite/documents/.
CREATE TABLE document_processing_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0,
 connection_id TEXT REFERENCES llm_provider_connections(id)
) STRICT;
INSERT INTO document_processing_settings(id) VALUES(1);
CREATE TABLE document_extractions (
 id TEXT PRIMARY KEY NOT NULL, source_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 profile TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, page_mode TEXT NOT NULL,
 warnings_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(source_blob_sha256,profile)
) STRICT;
CREATE TABLE document_jobs (
 id TEXT PRIMARY KEY NOT NULL, reference_version_id TEXT REFERENCES reference_versions(id),
 template_version_id TEXT REFERENCES template_versions(id), request_key TEXT UNIQUE NOT NULL,
 request_fingerprint TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL, definition_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN('queued','extracting','classifying','waiting_configuration','succeeded','failed','cancelled')),
 generation INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, attempt INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER, retry_at INTEGER NOT NULL DEFAULT 0,
 extraction_id TEXT REFERENCES document_extractions(id), config_id TEXT REFERENCES llm_provider_config_versions(id),
 error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((reference_version_id IS NULL)!=(template_version_id IS NULL))
) STRICT;
CREATE INDEX document_jobs_ready ON document_jobs(status,retry_at,created_at);
CREATE INDEX document_jobs_reference ON document_jobs(reference_version_id,created_at DESC,id);
CREATE INDEX document_jobs_template ON document_jobs(template_version_id,created_at DESC,id);
CREATE TABLE document_pages (
 id TEXT PRIMARY KEY NOT NULL, extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 ordinal INTEGER NOT NULL, source_page INTEGER, label TEXT NOT NULL, preview_blob_sha256 TEXT REFERENCES file_blobs(sha256),
 UNIQUE(extraction_id,ordinal)
) STRICT;
CREATE TABLE content_blocks (
 id TEXT PRIMARY KEY NOT NULL, page_id TEXT NOT NULL REFERENCES document_pages(id),
 position INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, attributes_json TEXT NOT NULL, image_blob_sha256 TEXT REFERENCES file_blobs(sha256),
 UNIQUE(page_id,position)
) STRICT;
CREATE TABLE document_decisions (
 job_id TEXT NOT NULL REFERENCES document_jobs(id), block_id TEXT NOT NULL REFERENCES content_blocks(id),
 predicate TEXT NOT NULL CHECK(predicate='is_table_of_contents'), value INTEGER NOT NULL CHECK(value IN(0,1)),
 statistics_json TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES llm_requests(id),
 PRIMARY KEY(job_id,block_id,predicate)
) STRICT;
CREATE TABLE document_job_commands (
 request_key TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES document_jobs(id),
 expected_version INTEGER NOT NULL, action TEXT NOT NULL
) STRICT;
CREATE TABLE document_job_events (
 id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES document_jobs(id),
 status TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE VIRTUAL TABLE content_blocks_fts USING fts5(text, content='content_blocks', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER content_blocks_fts_insert AFTER INSERT ON content_blocks BEGIN
 INSERT INTO content_blocks_fts(rowid,text) VALUES(new.rowid,new.text);
END;
PRAGMA user_version=8;
-- Initial processing is committed with new file versions, never backfilled over existing assets.
CREATE TRIGGER reference_document_job AFTER INSERT ON reference_versions BEGIN
 INSERT INTO document_jobs(id,reference_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;
CREATE TRIGGER template_document_job AFTER INSERT ON template_versions BEGIN
 INSERT INTO document_jobs(id,template_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;
CREATE TABLE template_extractions (
 id TEXT PRIMARY KEY NOT NULL REFERENCES document_jobs(id),
 source_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 profile TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
 manifest_json TEXT NOT NULL, native_structure_json TEXT NOT NULL,
 bundle_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256), created_at INTEGER NOT NULL
) STRICT;

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
