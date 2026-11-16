// Purpose: Keep Space JSON representations separate from library domain records.
// Pattern: Explicit read DTO conversion without filesystem paths or original document bodies.
// Usage: Space metadata/list/upload endpoints serialize these types.
// Related: mod.rs, frontend/src/features/space/api.ts.
use crate::modules::libraries::{FileVersion, Item, Kind};
use serde::Serialize;
#[derive(Serialize)]
pub(super) struct ItemDto {
    kind: String,
    id: String,
    title: String,
    tags: Vec<String>,
    status: String,
    version: i64,
    file_version: i64,
    filename: String,
    sha256: String,
    size_bytes: u64,
    mime: String,
    format: String,
    created_at: i64,
    updated_at: i64,
    processing: String,
}
impl From<Item> for ItemDto {
    fn from(v: Item) -> Self {
        Self {
            kind: match v.kind {
                Kind::Reference => "references".into(),
                Kind::Template => "templates".into(),
                Kind::Source(id) => format!("project-{id}"),
            },
            id: v.id.to_string(),
            title: v.title,
            tags: v.tags,
            status: v.status,
            version: v.version,
            file_version: v.file_version,
            filename: v.filename,
            sha256: v.blob_sha256,
            size_bytes: v.size,
            mime: v.mime,
            format: v.format,
            created_at: v.created_at,
            updated_at: v.updated_at,
            processing: v.processing,
        }
    }
}
#[derive(Serialize)]
pub(super) struct VersionDto {
    number: i64,
    filename: String,
    sha256: String,
    size_bytes: u64,
    mime: String,
    created_at: i64,
}
impl From<FileVersion> for VersionDto {
    fn from(v: FileVersion) -> Self {
        Self {
            number: v.number,
            filename: v.filename,
            sha256: v.blob_sha256,
            size_bytes: v.size,
            mime: v.mime,
            created_at: v.created_at,
        }
    }
}
