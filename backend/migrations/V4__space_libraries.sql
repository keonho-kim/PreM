-- Purpose: Persist shared library assets, immutable file versions and upload outcomes.
-- Pattern: Content-addressed bytes with normalized library relations and atomic receipts.
-- Usage: Applied by embedded refinery migrations before serving Space.
-- Related: modules/libraries/, adapters/sqlite/libraries/, modules/assets/.
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
CREATE INDEX reference_directory ON reference_items(deleted_at,status,updated_at DESC,id);
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
CREATE INDEX template_directory ON template_items(deleted_at,status,updated_at DESC,id);
CREATE TABLE upload_requests (
 request_key TEXT PRIMARY KEY NOT NULL,
 kind TEXT CHECK(kind IN ('reference','template')), target_id TEXT, expected_version INTEGER,
 attempt TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','failed','cancelled','complete')),
 fingerprint TEXT, reference_version_id TEXT REFERENCES reference_versions(id),
 template_version_id TEXT REFERENCES template_versions(id), created_at INTEGER NOT NULL,
 CHECK(state!='complete' OR ((reference_version_id IS NULL)!=(template_version_id IS NULL)))
) STRICT;
PRAGMA user_version=4;
