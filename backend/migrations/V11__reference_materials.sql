-- Purpose: Index reusable reference parts against immutable extraction and original file versions.
-- Pattern: Canonical text stays in content_blocks; native packages and previews use shared Blobs.
-- Usage: Append-only migration; existing extractions remain readable and require explicit preparation.
-- Related: modules/documents/materials.rs, adapters/sqlite/documents/materials.rs.
CREATE TABLE document_native_packages (
 extraction_id TEXT PRIMARY KEY NOT NULL REFERENCES document_extractions(id),
 bundle_blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 schema_version INTEGER NOT NULL CHECK(schema_version=1)
) STRICT;
CREATE UNIQUE INDEX document_page_identity ON document_pages(extraction_id,id);
CREATE UNIQUE INDEX document_block_identity ON content_blocks(page_id,id);
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
CREATE INDEX document_materials_page ON document_materials(extraction_id,page_id,source_order);
PRAGMA user_version=11;
