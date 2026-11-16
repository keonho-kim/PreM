ALTER TABLE projects ADD COLUMN end_date TEXT;
ALTER TABLE projects ADD COLUMN deleted_at INTEGER;
ALTER TABLE project_creation_requests ADD COLUMN original_end_date TEXT;
CREATE INDEX projects_directory ON projects(deleted_at, status, updated_at DESC, id);
CREATE INDEX projects_deadline ON projects(deleted_at, end_date, id);
PRAGMA user_version=2;
