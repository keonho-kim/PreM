-- Purpose: Name the single project deadline consistently without losing existing values.
-- Pattern: Append-only column renames; no project start or end interval is stored.
-- Usage: Embedded refinery migration applied after the Home schema.
-- Related: modules/projects/dates.rs, dev-docs/04-data-api.md.
ALTER TABLE projects RENAME COLUMN end_date TO due_date;
ALTER TABLE project_creation_requests RENAME COLUMN original_end_date TO original_due_date;
PRAGMA user_version=3;
