-- Purpose: Share immutable PPT imports and individual package members across library roles.
-- Pattern: Additive tables preserve legacy ZIP results; all binary bytes use common Blobs.
-- Usage: New extraction profiles create shared packages; historical records are never rewritten.
-- Related: modules/ppt_imports/, adapters/sqlite/ppt_imports.rs, filesystem/collection.rs.
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
PRAGMA user_version=12;
