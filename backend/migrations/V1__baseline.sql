-- Purpose: Initialize the complete PreM SQLite schema.
-- Pattern: Schema snapshot of the deployed V36 tables, indexes, views and triggers.
-- Usage: Immutable refinery baseline for new databases. Append V2 and later changes.
-- Related: adapters/sqlite/migrations.rs and migrations/README.md.
PRAGMA application_id=1347768408;

CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
, due_date TEXT, deleted_at INTEGER) STRICT;

CREATE TABLE project_creation_requests (
    request_key TEXT PRIMARY KEY NOT NULL,
    original_name TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
, original_due_date TEXT) STRICT;

CREATE TABLE file_blobs (
 sha256 TEXT PRIMARY KEY NOT NULL CHECK(length(sha256)=64),
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
 detected_mime TEXT NOT NULL, format TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE file_registrations (
 id TEXT PRIMARY KEY NOT NULL, blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 original_filename TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE reference_items (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), current_version_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 FOREIGN KEY(id,current_version_id) REFERENCES reference_versions(item_id,id)
) STRICT;

CREATE TABLE reference_versions (
 id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES reference_items(id),
 number INTEGER NOT NULL CHECK(number>0), file_registration_id TEXT NOT NULL REFERENCES file_registrations(id),
 created_at INTEGER NOT NULL, UNIQUE(item_id,number), UNIQUE(item_id,id)
) STRICT;

CREATE TABLE reference_tags (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL UNIQUE) STRICT;

CREATE TABLE reference_tag_links (
 item_id TEXT NOT NULL REFERENCES reference_items(id), tag_id TEXT NOT NULL REFERENCES reference_tags(id),
 PRIMARY KEY(item_id,tag_id)
) STRICT;

CREATE TABLE template_items (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), current_version_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 FOREIGN KEY(id,current_version_id) REFERENCES template_versions(item_id,id)
) STRICT;

CREATE TABLE template_versions (
 id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES template_items(id),
 number INTEGER NOT NULL CHECK(number>0), file_registration_id TEXT NOT NULL REFERENCES file_registrations(id),
 created_at INTEGER NOT NULL, UNIQUE(item_id,number), UNIQUE(item_id,id)
) STRICT;

CREATE TABLE template_tags (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL UNIQUE) STRICT;

CREATE TABLE template_tag_links (
 item_id TEXT NOT NULL REFERENCES template_items(id), tag_id TEXT NOT NULL REFERENCES template_tags(id),
 PRIMARY KEY(item_id,tag_id)
) STRICT;

CREATE TABLE "llm_provider_connections" (
 id TEXT PRIMARY KEY NOT NULL,current_config_version_id TEXT,
 FOREIGN KEY(id,current_config_version_id) REFERENCES "llm_provider_config_versions"(connection_id,id)
) STRICT;

CREATE TABLE "llm_requests" (
 id TEXT PRIMARY KEY NOT NULL,provider_config_version_id TEXT NOT NULL REFERENCES "llm_provider_config_versions"(id),
 kind TEXT NOT NULL CHECK(kind IN ('text','structured','decision')),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 elapsed_ms INTEGER,prompt_tokens INTEGER,completion_tokens INTEGER,error_code TEXT,created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE document_processing_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0,
 connection_id TEXT REFERENCES llm_provider_connections(id)
) STRICT;

CREATE TABLE document_extractions (
 id TEXT PRIMARY KEY NOT NULL, source_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 profile TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, page_mode TEXT NOT NULL,
 warnings_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(source_blob_sha256,profile)
) STRICT;

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

CREATE TABLE template_extractions (
 id TEXT PRIMARY KEY NOT NULL REFERENCES document_jobs(id),
 source_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 profile TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
 manifest_json TEXT NOT NULL, native_structure_json TEXT NOT NULL,
 bundle_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256), created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE template_previews (
 extraction_id TEXT NOT NULL REFERENCES template_extractions(id),
 ordinal INTEGER NOT NULL CHECK(ordinal>0),
 blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 PRIMARY KEY(extraction_id,ordinal)
) STRICT;

CREATE TABLE model_request_capacity (
 connection_id TEXT PRIMARY KEY NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0),
 max_parallel INTEGER NOT NULL CHECK(max_parallel BETWEEN 1 AND 1024),
 queue_capacity INTEGER NOT NULL CHECK(queue_capacity BETWEEN 0 AND 4096),
 queue_timeout_seconds INTEGER NOT NULL CHECK(queue_timeout_seconds BETWEEN 1 AND 600)
) STRICT;

CREATE TABLE document_native_packages (
 extraction_id TEXT PRIMARY KEY NOT NULL REFERENCES document_extractions(id),
 bundle_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 schema_version INTEGER NOT NULL CHECK(schema_version=1)
) STRICT;

CREATE TABLE document_materials (
 id TEXT PRIMARY KEY NOT NULL,
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 page_id TEXT NOT NULL REFERENCES document_pages(id),
 source_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('slide','page','image','diagram','chart','text','table')),
 source_order INTEGER NOT NULL CHECK(source_order>=0),
 title TEXT NOT NULL,
 content_block_id TEXT REFERENCES content_blocks(id),
 native_locator_json TEXT,
 preview_blob_sha256 TEXT REFERENCES file_blobs(sha256),
 preview_scope TEXT NOT NULL CHECK(preview_scope IN('item','page','none')),
 FOREIGN KEY(extraction_id,page_id) REFERENCES document_pages(extraction_id,id),
 FOREIGN KEY(page_id,content_block_id) REFERENCES content_blocks(page_id,id),
 UNIQUE(extraction_id,source_key)
) STRICT;

CREATE TABLE asset_package_members (
 package_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 path TEXT NOT NULL,
 blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 PRIMARY KEY(package_sha256,path)
) STRICT;

CREATE TABLE ppt_imports (
 source_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 profile TEXT NOT NULL,
 package_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(source_sha256,profile),
 UNIQUE(source_sha256,profile,package_sha256)
) STRICT;

CREATE TABLE template_import_links (
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES document_jobs(id),
 source_sha256 TEXT NOT NULL,
 profile TEXT NOT NULL,
 package_sha256 TEXT NOT NULL,
 FOREIGN KEY(source_sha256,profile,package_sha256)
 REFERENCES ppt_imports(source_sha256,profile,package_sha256)
) STRICT;

CREATE TABLE blob_collection_candidates (
 sha256 TEXT PRIMARY KEY NOT NULL,
 first_seen_at INTEGER NOT NULL
) STRICT;

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

CREATE TABLE "document_jobs" (
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

CREATE TABLE "upload_requests" (
 request_key TEXT PRIMARY KEY NOT NULL,
 kind TEXT CHECK(kind IN ('reference','template','source')), target_id TEXT, expected_version INTEGER,
 attempt TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','failed','cancelled','complete')),
 fingerprint TEXT, reference_version_id TEXT REFERENCES reference_versions(id),
 template_version_id TEXT REFERENCES template_versions(id), source_version_id TEXT REFERENCES source_versions(id), project_id TEXT REFERENCES projects(id), created_at INTEGER NOT NULL,
 CHECK(state!='complete' OR ((reference_version_id IS NOT NULL)+(template_version_id IS NOT NULL)+(source_version_id IS NOT NULL)=1))
) STRICT;

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

CREATE TABLE relation_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0,
 connection_id TEXT REFERENCES llm_provider_connections(id)
, planner_connection_id TEXT REFERENCES llm_provider_connections(id)) STRICT;

CREATE TABLE relation_runs (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, query TEXT NOT NULL,
 options_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
 guide_revision_id TEXT REFERENCES project_guide_revisions(id),
 config_id TEXT REFERENCES llm_provider_config_versions(id),
 definition_version INTEGER NOT NULL DEFAULT 1 CHECK(definition_version=1),
 status TEXT NOT NULL CHECK(status IN('queued','running','waiting_configuration','succeeded','failed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, attempt INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER, error_code TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE relation_sources (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 PRIMARY KEY(run_id,source_version_id)
) STRICT;

CREATE TABLE relation_assessments (
 cache_key TEXT PRIMARY KEY NOT NULL, context_hash TEXT NOT NULL,
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 block_id TEXT REFERENCES content_blocks(id),
 config_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),
 definition_version INTEGER NOT NULL CHECK(definition_version=1),
 relation INTEGER NOT NULL CHECK(relation BETWEEN 0 AND 5),
 statistics_json TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES llm_requests(id),
 created_at INTEGER NOT NULL
, context_version INTEGER NOT NULL DEFAULT 1 CHECK(context_version IN(1,2))) STRICT;

CREATE TABLE relation_candidates (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES relation_runs(id),
 ordinal INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('file','block')),
 extraction_id TEXT NOT NULL REFERENCES document_extractions(id),
 block_id TEXT REFERENCES content_blocks(id), excerpt_block_id TEXT NOT NULL REFERENCES content_blocks(id),
 assessment_key TEXT REFERENCES relation_assessments(cache_key), cache_hit INTEGER NOT NULL DEFAULT 0 CHECK(cache_hit IN(0,1)), workspace_round INTEGER NOT NULL DEFAULT 0 CHECK(workspace_round BETWEEN 0 AND 2),
 UNIQUE(run_id,ordinal), CHECK((kind='file' AND block_id IS NULL) OR (kind='block' AND block_id IS NOT NULL AND block_id=excerpt_block_id))
) STRICT;

CREATE TABLE relation_origins (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 PRIMARY KEY(candidate_id,source_version_id)
) STRICT;

CREATE TABLE relation_commands (
 request_key TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES relation_runs(id),
 expected_version INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN('retry','cancel'))
) STRICT;

CREATE TABLE relation_links (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 source_version_id TEXT NOT NULL REFERENCES source_versions(id),
 version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL CHECK(active IN(0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE relation_link_changes (
 selection_id TEXT NOT NULL REFERENCES relation_links(id), version INTEGER NOT NULL,
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id), active INTEGER NOT NULL CHECK(active IN(0,1)),
 created_at INTEGER NOT NULL, PRIMARY KEY(selection_id,version)
) STRICT;

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

CREATE TABLE relation_workspaces (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES relation_runs(id),
 definition_version INTEGER NOT NULL DEFAULT 2 CHECK(definition_version=2),
 round INTEGER NOT NULL DEFAULT 0 CHECK(round BETWEEN 0 AND 2),
 phase TEXT NOT NULL DEFAULT 'compare' CHECK(phase IN('compare','context','discover','complete')),
 planner_config_id TEXT REFERENCES llm_provider_config_versions(id),
 deadline_at INTEGER,
 stop_reason TEXT CHECK(stop_reason IN('reviewed','needs_review','no_new_results','budget')),
 created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE relation_reads (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 round INTEGER NOT NULL CHECK(round BETWEEN 0 AND 2),
 position INTEGER NOT NULL,
 block_id TEXT NOT NULL REFERENCES content_blocks(id),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 1800),
 PRIMARY KEY(candidate_id,round,position), UNIQUE(candidate_id,round,block_id)
) STRICT;

CREATE TABLE relation_review_history (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 round INTEGER NOT NULL,
 assessment_key TEXT NOT NULL REFERENCES relation_assessments(cache_key),
 PRIMARY KEY(candidate_id,round)
) STRICT;

CREATE TABLE relation_workspace_peers (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 position INTEGER NOT NULL,
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 block_id TEXT NOT NULL REFERENCES content_blocks(id),
 relation INTEGER NOT NULL CHECK(relation IN(2,4)),
 PRIMARY KEY(run_id,position)
) STRICT;

CREATE TABLE relation_pulls (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 ordinal INTEGER NOT NULL,
 query TEXT NOT NULL,
 request_id TEXT REFERENCES llm_requests(id),
 added INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,ordinal), UNIQUE(run_id,query)
) STRICT;

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

CREATE TABLE presentation_slide_versions (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES presentation_runs(id),position INTEGER NOT NULL,
 node_id TEXT REFERENCES outline_nodes(id),spec_sha256 TEXT REFERENCES file_blobs(sha256),
 preview_sha256 TEXT REFERENCES file_blobs(sha256),request_id TEXT REFERENCES llm_requests(id), slide_key TEXT,
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

CREATE TABLE presentation_run_slides (
 run_id TEXT NOT NULL REFERENCES presentation_runs(id),slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),position INTEGER NOT NULL,
 PRIMARY KEY(run_id,position),UNIQUE(run_id,slide_version_id)
) STRICT;

CREATE TABLE presentation_edit_commands (
 request_key TEXT PRIMARY KEY,edit_id TEXT NOT NULL REFERENCES presentation_edits(id),expected_version INTEGER NOT NULL,action TEXT NOT NULL
) STRICT;

CREATE TABLE presentation_media (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,
 original_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 width INTEGER NOT NULL,height INTEGER NOT NULL,created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE presentation_edit_targets (
 edit_id TEXT NOT NULL REFERENCES presentation_edits(id),source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),
 position INTEGER NOT NULL,object_ids_json TEXT NOT NULL DEFAULT '[]',
 proposed_spec_sha256 TEXT REFERENCES file_blobs(sha256),message TEXT,request_id TEXT REFERENCES llm_requests(id),
 PRIMARY KEY(edit_id,source_slide_id),UNIQUE(edit_id,position)
) STRICT;

CREATE TABLE presentation_edit_media (
 edit_id TEXT NOT NULL REFERENCES presentation_edits(id),media_id TEXT NOT NULL REFERENCES presentation_media(id),
 PRIMARY KEY(edit_id,media_id)
) STRICT;

CREATE TABLE presentation_slide_media (
 slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),media_id TEXT NOT NULL REFERENCES presentation_media(id),
 PRIMARY KEY(slide_version_id,media_id)
) STRICT;

CREATE TABLE presentation_edit_target_media (
 edit_id TEXT NOT NULL,source_slide_id TEXT NOT NULL,media_id TEXT NOT NULL REFERENCES presentation_media(id),
 PRIMARY KEY(edit_id,source_slide_id,media_id),
 FOREIGN KEY(edit_id,source_slide_id) REFERENCES presentation_edit_targets(edit_id,source_slide_id)
) STRICT;

CREATE TABLE presentation_editor_sessions (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 head_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE presentation_undo_stack (
 session_id TEXT NOT NULL REFERENCES presentation_editor_sessions(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 3),
 revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),PRIMARY KEY(session_id,position)
) STRICT;

CREATE TABLE presentation_run_sessions (
 run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),session_id TEXT NOT NULL REFERENCES presentation_editor_sessions(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE presentation_restorations (
 run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),source_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),
 previous_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),request_key TEXT NOT NULL UNIQUE,expected_version INTEGER NOT NULL
) STRICT;

CREATE TABLE presentation_edit_renders (
 edit_id TEXT PRIMARY KEY REFERENCES presentation_edits(id),output_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256)
) STRICT;

CREATE TABLE presentation_edit_previews (
 edit_id TEXT NOT NULL REFERENCES presentation_edit_renders(edit_id),source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),
 position INTEGER NOT NULL,preview_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 PRIMARY KEY(edit_id,source_slide_id),UNIQUE(edit_id,position)
) STRICT;

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

CREATE TABLE workflow_artifacts (
 workflow_id TEXT NOT NULL,node_key TEXT NOT NULL,role TEXT NOT NULL,position INTEGER NOT NULL,
 blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),PRIMARY KEY(workflow_id,node_key,role,position),
 FOREIGN KEY(workflow_id,node_key) REFERENCES workflow_nodes(workflow_id,node_key)
) STRICT;

CREATE TABLE document_workflows (
 job_id TEXT PRIMARY KEY REFERENCES document_jobs(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)
) STRICT;

CREATE TABLE outline_workflows (
 run_id TEXT PRIMARY KEY REFERENCES outline_runs(id),
 workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)
) STRICT;

CREATE TABLE relation_workflows(run_id TEXT PRIMARY KEY REFERENCES relation_runs(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)) STRICT;

CREATE TABLE presentation_material_imports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),job_id TEXT NOT NULL REFERENCES document_jobs(id),material_id TEXT NOT NULL REFERENCES document_materials(id),UNIQUE(project_id,job_id,material_id)) STRICT;

CREATE TABLE presentation_slide_imports(slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(slide_version_id,import_id)) STRICT;

CREATE TABLE presentation_edit_imports(edit_id TEXT NOT NULL REFERENCES presentation_edits(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(edit_id,import_id)) STRICT;

CREATE TABLE presentation_edit_target_imports(edit_id TEXT NOT NULL REFERENCES presentation_edits(id),source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(edit_id,source_slide_id,import_id)) STRICT;

CREATE TABLE presentation_generation_imports(run_id TEXT NOT NULL REFERENCES presentation_runs(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(run_id,import_id)) STRICT;

CREATE TABLE presentation_reference_drafts(run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),base_spec_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256)) STRICT;

CREATE TABLE slide_edit_workflows(edit_id TEXT PRIMARY KEY REFERENCES presentation_edits(id),workflow_id TEXT NOT NULL UNIQUE REFERENCES workflow_executions(id)) STRICT;

CREATE TABLE presentation_render_cache(project_id TEXT NOT NULL REFERENCES projects(id),cache_key TEXT NOT NULL,output_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),preview_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),report_json TEXT NOT NULL CHECK(json_valid(report_json)),last_used_at INTEGER NOT NULL,PRIMARY KEY(project_id,cache_key)) STRICT;

CREATE TABLE presentation_quality_checks(workflow_id TEXT NOT NULL REFERENCES workflow_executions(id),project_id TEXT NOT NULL REFERENCES projects(id),style_key TEXT NOT NULL,slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),position INTEGER NOT NULL,passed INTEGER NOT NULL CHECK(passed IN(0,1)),report_json TEXT NOT NULL CHECK(json_valid(report_json)),reused INTEGER NOT NULL CHECK(reused IN(0,1)), cache_key TEXT,PRIMARY KEY(workflow_id,slide_version_id)) STRICT;

CREATE TABLE presentation_manual_designs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),template_job_id TEXT REFERENCES document_jobs(id),created_at INTEGER NOT NULL) STRICT;

CREATE TABLE "presentation_runs" (
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

CREATE TABLE "presentation_edits" (
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

CREATE TABLE presentation_canvas_commands(run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),base_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),operation TEXT NOT NULL) STRICT;

CREATE TABLE presentation_render_layers(project_id TEXT NOT NULL,cache_key TEXT NOT NULL,object_key TEXT NOT NULL,blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),frame_json TEXT NOT NULL CHECK(json_valid(frame_json)),PRIMARY KEY(project_id,cache_key,object_key),FOREIGN KEY(project_id,cache_key) REFERENCES presentation_render_cache(project_id,cache_key) ON DELETE CASCADE) STRICT;

CREATE TABLE "llm_provider_config_versions" (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible','openai','claude','gemini','lm_studio_native','llama_cpp','sglang','vllm','litellm','typesafe','lm_studio_decision','llama_decision','sglang_decision','vllm_decision','vllm_sr_decision','litellm_decision','openai_decision','gemini_decision')),
 base_url TEXT NOT NULL,model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 900),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),encrypted_secret TEXT,created_at INTEGER NOT NULL,
 max_output_tokens INTEGER CHECK(max_output_tokens IS NULL OR max_output_tokens BETWEEN 256 AND 65536), context_length INTEGER CHECK(context_length BETWEEN 1 AND 2147483647), physical_batch_size INTEGER CHECK(physical_batch_size BETWEEN 1 AND 2147483647),
 UNIQUE(connection_id,id),UNIQUE(connection_id,version)
) STRICT;

CREATE TABLE decision_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    version INTEGER NOT NULL,
    connection_id TEXT REFERENCES llm_provider_connections(id)
);

CREATE TABLE document_alignment (
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 task_key TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 request_id TEXT NOT NULL REFERENCES llm_requests(id),
 PRIMARY KEY(job_id,task_key)
);

CREATE TABLE document_page_alignments (
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 page_id TEXT NOT NULL REFERENCES document_pages(id),
 role TEXT NOT NULL CHECK(role IN ('start','body','divider','divider_start','contents','unknown','range')),
 section TEXT, preceding_section TEXT,
 toc_block TEXT REFERENCES content_blocks(id),
 toc_line INTEGER, toc_printed_start INTEGER,
 evidence_block TEXT REFERENCES content_blocks(id),
 printed_page INTEGER,
 PRIMARY KEY(job_id,page_id)
);

CREATE TABLE document_source_entries (
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 position INTEGER NOT NULL, parent INTEGER,
 title TEXT NOT NULL, printed INTEGER,
 block_id TEXT NOT NULL REFERENCES content_blocks(id), line INTEGER NOT NULL,
 PRIMARY KEY(job_id,position), FOREIGN KEY(job_id,parent) REFERENCES document_source_entries(job_id,position)
);

CREATE INDEX projects_updated ON projects(updated_at DESC, id);

CREATE INDEX projects_directory ON projects(deleted_at, status, updated_at DESC, id);

CREATE INDEX projects_deadline ON projects(deleted_at, due_date, id);

CREATE INDEX reference_directory ON reference_items(deleted_at,status,updated_at DESC,id);

CREATE INDEX template_directory ON template_items(deleted_at,status,updated_at DESC,id);

CREATE INDEX llm_requests_recent ON llm_requests(provider_config_version_id,created_at DESC);

CREATE UNIQUE INDEX document_page_identity ON document_pages(extraction_id,id);

CREATE UNIQUE INDEX document_block_identity ON content_blocks(page_id,id);

CREATE INDEX document_materials_page ON document_materials(extraction_id,page_id,source_order);

CREATE INDEX source_project ON source_items(project_id,deleted_at,updated_at);

CREATE INDEX document_jobs_ready ON document_jobs(status,retry_at,created_at);

CREATE INDEX document_jobs_reference ON document_jobs(reference_version_id,created_at DESC,id);

CREATE INDEX document_jobs_template ON document_jobs(template_version_id,created_at DESC,id);

CREATE UNIQUE INDEX document_reference_generation ON document_jobs(reference_version_id,generation);

CREATE UNIQUE INDEX document_template_generation ON document_jobs(template_version_id,generation);

CREATE UNIQUE INDEX document_source_generation ON document_jobs(source_version_id,generation);

CREATE INDEX relation_runs_queue ON relation_runs(status,created_at,id);

CREATE INDEX relation_runs_project ON relation_runs(project_id,created_at DESC,id);

CREATE UNIQUE INDEX relation_file_candidate_identity ON relation_candidates(run_id,extraction_id) WHERE kind='file';

CREATE UNIQUE INDEX relation_block_candidate_identity ON relation_candidates(run_id,block_id) WHERE kind='block';

CREATE INDEX relation_links_project ON relation_links(project_id,active);

CREATE INDEX job_extraction_lookup ON document_jobs(extraction_id,source_version_id);

CREATE INDEX outline_runs_queue ON outline_runs(status,created_at,id);

CREATE INDEX outline_runs_project ON outline_runs(project_id,created_at DESC);

CREATE INDEX relation_reads_block ON relation_reads(block_id);

CREATE INDEX presentation_media_project ON presentation_media(project_id,created_at,id);

CREATE INDEX presentation_editor_expiry ON presentation_editor_sessions(expires_at);

CREATE INDEX workflow_event_cursor ON workflow_events(workflow_id,id);

CREATE INDEX presentation_quality_styles ON presentation_quality_checks(project_id,style_key,passed);

CREATE INDEX presentation_queue ON presentation_runs(status,created_at,id);

CREATE INDEX presentation_project_runs ON presentation_runs(project_id,created_at DESC,id);

CREATE INDEX presentation_edits_queue ON presentation_edits(status,created_at,id);

CREATE INDEX presentation_edits_thread ON presentation_edits(project_id,presentation_id,node_id,created_at,id);

CREATE VIEW registered_file_facts AS
SELECT f.id AS registration_id,b.sha256,b.size_bytes,
 CASE
  WHEN lower(f.original_filename) GLOB '*.md' OR lower(f.original_filename) GLOB '*.markdown' THEN 'md'
  WHEN lower(f.original_filename) GLOB '*.html' OR lower(f.original_filename) GLOB '*.htm' THEN 'html'
  ELSE b.format
 END AS format,
 CASE
  WHEN lower(f.original_filename) GLOB '*.md' OR lower(f.original_filename) GLOB '*.markdown' THEN 'text/markdown'
  WHEN lower(f.original_filename) GLOB '*.html' OR lower(f.original_filename) GLOB '*.htm' THEN 'text/html'
  ELSE b.detected_mime
 END AS detected_mime
FROM file_registrations f JOIN file_blobs b ON b.sha256=f.blob_sha256;

CREATE TRIGGER content_blocks_fts_insert AFTER INSERT ON content_blocks BEGIN
 INSERT INTO content_blocks_fts(rowid,text) VALUES(new.rowid,new.text);
END;

CREATE TRIGGER reference_document_job AFTER INSERT ON reference_versions BEGIN
 INSERT INTO document_jobs(id,reference_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;

CREATE TRIGGER template_document_job AFTER INSERT ON template_versions BEGIN
 INSERT INTO document_jobs(id,template_version_id,request_key,profile,status,created_at,updated_at)
 VALUES(new.id,new.id,'initial:'||new.id,'pending','queued',new.created_at,new.created_at);
END;

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

CREATE TRIGGER relation_project_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE relation_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1,updated_at=new.updated_at
 WHERE project_id=new.id AND status IN('queued','running','waiting_configuration');
END;

CREATE TRIGGER project_outline_cancel AFTER UPDATE OF deleted_at ON projects
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
 UPDATE outline_runs SET status='cancelled',lease=NULL,lease_until=NULL,version=version+1 WHERE project_id=new.id AND status IN('queued','running');
END;

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

CREATE TRIGGER presentation_slide_key AFTER INSERT ON presentation_slide_versions WHEN new.slide_key IS NULL BEGIN UPDATE presentation_slide_versions SET slide_key=coalesce(new.node_id,new.id) WHERE id=new.id; END;

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

INSERT INTO relation_settings (id, version, connection_id, planner_connection_id) VALUES (1, 0, NULL, NULL);

INSERT INTO document_processing_settings (id, version, connection_id) VALUES (1, 0, NULL);

INSERT INTO decision_settings (id, version, connection_id) VALUES (1, 0, NULL);

PRAGMA user_version=1;
