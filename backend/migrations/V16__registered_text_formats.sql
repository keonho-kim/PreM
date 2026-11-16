-- Purpose: Resolve text interpretation per immutable filename while sharing identical Blob bytes.
-- Pattern: One read projection; HTML and Markdown can contain identical UTF-8 source bytes.
-- Usage: Upload facts, downloads, extraction jobs and search filters read this projection.
-- Related: file_registrations, file_blobs, adapters/markdown/.
CREATE VIEW registered_file_facts AS
SELECT f.id AS registration_id,b.sha256,b.size_bytes,
 CASE
  WHEN lower(f.original_filename) GLOB '*.md' OR lower(f.original_filename) GLOB '*.markdown' THEN 'md'
  WHEN lower(f.original_filename) GLOB '*.html' OR lower(f.original_filename) GLOB '*.htm' THEN 'html'
  ELSE b.format
 END AS format,
 CASE
  WHEN lower(f.original_filename) GLOB '*.md' OR lower(f.original_filename) GLOB '*.markdown' THEN 'text/markdown'
  WHEN lower(f.original_filename) GLOB '*.html' OR lower(f.original_filename) GLOB '*.htm' THEN 'text/html'
  ELSE b.detected_mime
 END AS detected_mime
FROM file_registrations f JOIN file_blobs b ON b.sha256=f.blob_sha256;
PRAGMA user_version=16;
