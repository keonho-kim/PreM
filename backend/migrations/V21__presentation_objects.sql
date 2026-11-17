-- Purpose: Persist immutable slide media and per-slide edit checkpoints for batch proposals.
-- Pattern: Canonical Blob references, frozen target membership and conditional publication.
-- Usage: V20 edits remain readable and are backfilled as one-target conversations.
-- Related: modules/presentations/objects.rs, adapters/sqlite/presentations/edits/targets.rs.
CREATE TABLE presentation_media (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,
 original_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),
 width INTEGER NOT NULL,height INTEGER NOT NULL,created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX presentation_media_project ON presentation_media(project_id,created_at,id);
CREATE TABLE presentation_edit_targets (
 edit_id TEXT NOT NULL REFERENCES presentation_edits(id),source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),
 position INTEGER NOT NULL,object_ids_json TEXT NOT NULL DEFAULT '[]',
 proposed_spec_sha256 TEXT REFERENCES file_blobs(sha256),message TEXT,request_id TEXT REFERENCES llm_requests(id),
 PRIMARY KEY(edit_id,source_slide_id),UNIQUE(edit_id,position)
) STRICT;
INSERT INTO presentation_edit_targets(edit_id,source_slide_id,position,proposed_spec_sha256,message,request_id)
 SELECT e.id,e.source_slide_id,s.position,e.proposed_spec_sha256,e.message,e.request_id FROM presentation_edits e
 JOIN presentation_slide_versions s ON s.id=e.source_slide_id;
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
PRAGMA user_version=21;
