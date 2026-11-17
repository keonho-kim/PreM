-- Purpose: Pin reusable source material and independent slide identities in generated revisions.
-- Pattern: Reference existing canonical jobs/materials; no copied source bytes or text.
-- Usage: Explicit material insertion and bounded agent proposals.
-- Related: presentations/references/, document_materials, immutable presentation revisions.
CREATE TABLE presentation_material_imports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),job_id TEXT NOT NULL REFERENCES document_jobs(id),material_id TEXT NOT NULL REFERENCES document_materials(id),UNIQUE(project_id,job_id,material_id)) STRICT;
CREATE TABLE presentation_slide_imports(slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(slide_version_id,import_id)) STRICT;
CREATE TABLE presentation_edit_imports(edit_id TEXT NOT NULL REFERENCES presentation_edits(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(edit_id,import_id)) STRICT;
CREATE TABLE presentation_edit_target_imports(edit_id TEXT NOT NULL REFERENCES presentation_edits(id),source_slide_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(edit_id,source_slide_id,import_id)) STRICT;
CREATE TABLE presentation_generation_imports(run_id TEXT NOT NULL REFERENCES presentation_runs(id),import_id TEXT NOT NULL REFERENCES presentation_material_imports(id),PRIMARY KEY(run_id,import_id)) STRICT;
CREATE TABLE presentation_reference_drafts(run_id TEXT PRIMARY KEY REFERENCES presentation_runs(id),slide_version_id TEXT NOT NULL REFERENCES presentation_slide_versions(id),base_spec_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256)) STRICT;
ALTER TABLE presentation_slide_versions ADD COLUMN slide_key TEXT;
UPDATE presentation_slide_versions SET slide_key=coalesce(node_id,id);
CREATE TRIGGER presentation_slide_key AFTER INSERT ON presentation_slide_versions WHEN new.slide_key IS NULL BEGIN UPDATE presentation_slide_versions SET slide_key=coalesce(new.node_id,new.id) WHERE id=new.id; END;
PRAGMA user_version=27;
