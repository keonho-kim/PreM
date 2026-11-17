-- Purpose: Cache passive background/object PNGs for direct manipulation of native slide artwork.
-- Pattern: Derived cache rows reference canonical Blobs; eviction preserves full slide/PPTX outputs.
-- Usage: Quality commits bind the exact render key to each passed slide checkpoint.
-- Related: presentation-layers.py, presentation-previews.mjs, presentations/layers.rs.
ALTER TABLE presentation_quality_checks ADD COLUMN cache_key TEXT;
CREATE TABLE presentation_render_layers(project_id TEXT NOT NULL,cache_key TEXT NOT NULL,object_key TEXT NOT NULL,blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),frame_json TEXT NOT NULL CHECK(json_valid(frame_json)),PRIMARY KEY(project_id,cache_key,object_key),FOREIGN KEY(project_id,cache_key) REFERENCES presentation_render_cache(project_id,cache_key) ON DELETE CASCADE) STRICT;
PRAGMA user_version=31;
