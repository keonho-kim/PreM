-- Purpose: Preserve ordered original chapters and child rows from one document processing revision.
-- Pattern: Parent positions and immutable block/line references retain the original hierarchy.
-- Usage: Published atomically with physical page assignments.
-- Related: sqlite/documents/source_outline.rs, documents/alignment/catalog.rs.
CREATE TABLE document_source_entries (
 job_id TEXT NOT NULL REFERENCES document_jobs(id),
 position INTEGER NOT NULL, parent INTEGER,
 title TEXT NOT NULL, printed INTEGER,
 block_id TEXT NOT NULL REFERENCES content_blocks(id), line INTEGER NOT NULL,
 PRIMARY KEY(job_id,position), FOREIGN KEY(job_id,parent) REFERENCES document_source_entries(job_id,position)
);
PRAGMA user_version=36;
