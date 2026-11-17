-- Purpose: Persist per-slide quality outcomes and reusable validated native rendering artifacts.
-- Pattern: Project-scoped content keys; lease-fenced checks reference canonical execution/slide IDs.
-- Usage: Resume only missing renders; cache eviction never removes confirmed revisions.
-- Related: presentations/quality.rs, presentation-render.py, workflow_executions.
CREATE TABLE presentation_render_cache(project_id TEXT NOT NULL REFERENCES projects(id),cache_key TEXT NOT NULL,output_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),preview_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256),report_json TEXT NOT NULL CHECK(json_valid(report_json)),last_used_at INTEGER NOT NULL,PRIMARY KEY(project_id,cache_key)) STRICT;
CREATE TABLE presentation_quality_checks(workflow_id TEXT NOT NULL REFERENCES workflow_executions(id),project_id TEXT NOT NULL REFERENCES projects(id),style_key TEXT NOT NULL,slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),position INTEGER NOT NULL,passed INTEGER NOT NULL CHECK(passed IN(0,1)),report_json TEXT NOT NULL CHECK(json_valid(report_json)),reused INTEGER NOT NULL CHECK(reused IN(0,1)),PRIMARY KEY(workflow_id,slide_version_id)) STRICT;
CREATE INDEX presentation_quality_styles ON presentation_quality_checks(project_id,style_key,passed);
PRAGMA user_version=29;
