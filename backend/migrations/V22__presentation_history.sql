-- Purpose: Retain three session-owned undo targets and validated proposal preview artifacts.
-- Pattern: Undo creates a new immutable revision; preview bytes are reused at acceptance.
-- Usage: Canvas compare/undo controls; existing revisions and files remain intact.
-- Related: presentations/history.rs, presentations/edits/render.rs.
CREATE TABLE presentation_editor_sessions (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),presentation_id TEXT NOT NULL REFERENCES presentations(id),
 head_revision_id TEXT NOT NULL REFERENCES presentation_revisions(id),expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX presentation_editor_expiry ON presentation_editor_sessions(expires_at);
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
PRAGMA user_version=22;
