-- Purpose: Persist the shared project directory and retry-safe creation requests.
-- Pattern: Initial append-only schema with constraints and optimistic revisions.
-- Usage: Embedded by refinery during application startup.
-- Related: adapters/sqlite/migrations.rs, modules/projects/mod.rs.
CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX projects_updated ON projects(updated_at DESC, id);
CREATE TABLE project_creation_requests (
    request_key TEXT PRIMARY KEY NOT NULL,
    original_name TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
) STRICT;
PRAGMA application_id = 1347768408;
PRAGMA user_version = 1;
