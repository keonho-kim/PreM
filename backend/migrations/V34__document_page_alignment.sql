-- Purpose: Record job-scoped source contents decisions and physical page assignments.
-- Pattern: Immutable checkpoints share the document lease and pinned inference lineage.
-- Usage: Embedded migration; completed historical jobs have no alignment rows.
-- Related: modules/documents/alignment/, sqlite/documents/alignment.rs.
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
PRAGMA user_version=34;
