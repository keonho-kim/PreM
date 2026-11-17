// Purpose: Define current-slide conversational edits with a pinned, explicit field allowlist.
// Pattern: Proposals and completed publication are separate states; original specs remain immutable.
// Usage: Edit admission, worker, HTTP and the slide-scoped chat thread.
// Related: editing/commands.rs, editing/request.rs, V20 migration.
use super::*;
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EditRequest {
    pub expected_version: i64,
    pub connection_id: Option<Uuid>,
    pub model_version: Option<i64>,
    pub prompt: String,
    pub fields: Vec<String>,
    #[serde(default)]
    pub slide_ids: Vec<Uuid>,
    #[serde(default)]
    pub object_ids: Vec<String>,
}
#[derive(Clone, Serialize)]
pub(crate) struct Edit {
    pub steps: Vec<crate::workflows::engine::Stage>,
    pub quality: Vec<SlideQuality>,
    #[serde(skip)]
    pub references: Vec<ImportedMaterial>,
    pub id: Uuid,
    pub project_id: Uuid,
    pub presentation_id: Uuid,
    pub base_revision_id: Uuid,
    pub base_version: i64,
    pub source_slide_id: Uuid,
    pub connection_id: Uuid,
    pub prompt: String,
    pub fields: Vec<String>,
    pub status: String,
    pub version: i64,
    pub message: Option<String>,
    pub error_code: Option<String>,
    pub applied_run_id: Option<Uuid>,
    pub render_status: Option<String>,
    pub created_at: i64,
    pub targets: Vec<EditTarget>,
    pub preview: bool,
    #[serde(skip)]
    pub object_ids: Vec<String>,
    #[serde(skip)]
    pub media: Vec<Media>,
    #[serde(skip)]
    pub config_id: Uuid,
    #[serde(skip)]
    pub lease: Option<String>,
    #[serde(skip)]
    pub runtime_profile: String,
    #[serde(skip)]
    pub source_spec: String,
    #[serde(skip)]
    pub proposed_spec: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct EditView {
    #[serde(flatten)]
    pub edit: Edit,
    pub before: SlideSpec,
    pub proposal: Option<SlideSpec>,
    pub slides: Vec<EditSlideView>,
}
pub(crate) struct EditPlan {
    pub context: serde_json::Value,
    pub original: SlideSpec,
}
pub(crate) struct EditOutput {
    pub spec: SlideSpec,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct EditTarget {
    pub slide_id: Uuid,
    pub position: i64,
    pub object_ids: Vec<String>,
    pub completed: bool,
    #[serde(skip)]
    pub source_spec: String,
    #[serde(skip)]
    pub proposed_spec: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct EditSlideView {
    pub slide_id: Uuid,
    pub position: i64,
    pub before: SlideSpec,
    pub proposal: Option<SlideSpec>,
}

pub(crate) struct UsedAssets {
    pub media: Vec<Uuid>,
    pub references: Vec<Uuid>,
}
