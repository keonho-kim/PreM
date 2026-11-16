// Purpose: Describe reusable source slides, artwork and canonical content references.
// Pattern: Immutable source locators and version-bound choices, independent of future PPT generation.
// Usage: Extraction emits native materials; Space reads the catalog without copying original text.
// Related: types.rs, adapters/sqlite/documents/materials.rs, backend/tools/reference-materials.py.
use super::ExtractedFile;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeMaterial {
    pub key: String,
    pub source_page: i64,
    pub kind: String,
    pub title: String,
    pub locator: NativeLocator,
    pub preview: Option<String>,
    pub preview_scope: String,
    #[serde(default)]
    pub bbox: Option<[f64; 4]>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeLocator {
    pub slide_part: String,
    pub shape_ids: Vec<String>,
    pub image_part: Option<String>,
    pub image_asset: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativePackage {
    pub bundle: ExtractedFile,
    pub materials: Vec<NativeMaterial>,
}
#[derive(Serialize)]
pub(crate) struct Material {
    pub id: Uuid,
    pub page_id: Uuid,
    pub page_label: String,
    pub source_page: Option<i64>,
    pub kind: String,
    pub title: String,
    pub text: Option<String>,
    pub content_block_id: Option<Uuid>,
    pub preview: Option<String>,
    pub preview_scope: String,
    pub native: Option<NativeLocator>,
}
#[derive(Serialize)]
pub(crate) struct MaterialCatalog {
    pub schema_version: i64,
    pub reference_id: Uuid,
    pub job_id: Uuid,
    pub file_version: i64,
    pub source_sha256: String,
    pub extraction_id: Option<Uuid>,
    pub bundle: Option<String>,
    pub ready: bool,
    pub total: i64,
    pub items: Vec<Material>,
}
