-- Purpose: Preserve passive slide previews alongside immutable template analyses.
-- Pattern: Foreign-keyed content-addressed images; no source or prior extraction rewrites.
-- Usage: Embedded migration before template processing starts.
-- Related: modules/templates/, adapters/sqlite/templates.rs.
CREATE TABLE template_previews (
 extraction_id TEXT NOT NULL REFERENCES template_extractions(id),
 ordinal INTEGER NOT NULL CHECK(ordinal>0),
 blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 PRIMARY KEY(extraction_id,ordinal)
) STRICT;
PRAGMA user_version=9;
