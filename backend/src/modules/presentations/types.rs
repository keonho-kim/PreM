// Purpose: Define immutable presentation input, slide and job contracts.
// Pattern: Typed commands and canonical IDs keep source text out of saved preparation rows.
// Usage: Presentation service, persistence/process adapters and HTTP boundary.
// Related: mod.rs, V19__presentation_generation.sql.
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Serialize)]
pub(crate) struct Preparation {
    pub version: i64,
    pub fingerprint: String,
    pub ready: bool,
    pub evidence_review_id: Option<Uuid>,
    pub selected_count: i64,
    pub design_id: Option<Uuid>,
    pub template_job_id: Option<Uuid>,
    pub slide_count: i64,
    pub generated: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Design {
    pub expected_version: i64,
    pub evidence_review_id: Uuid,
    pub template_job_id: Option<Uuid>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Generate {
    pub design_id: Uuid,
    pub title: String,
    pub instructions: String,
    pub connection_id: Uuid,
    pub model_version: i64,
    pub presentation_id: Option<Uuid>,
    pub expected_version: i64,
}
#[derive(Clone, Serialize)]
pub(crate) struct Run {
    pub id: Uuid,
    pub project_id: Uuid,
    pub presentation_id: Uuid,
    pub title: String,
    pub presentation_version: i64,
    pub is_current: bool,
    pub status: String,
    pub stage: String,
    pub version: i64,
    pub completed: i64,
    pub total: i64,
    pub error_code: Option<String>,
    pub created_at: i64,
    #[serde(skip)]
    pub config_id: Uuid,
    #[serde(skip)]
    pub lease: Option<String>,
    #[serde(skip)]
    pub runtime_profile: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SlideSpec {
    pub schema_version: i64,
    pub title: String,
    pub bullets: Vec<String>,
    pub notes: String,
    pub block_ids: Vec<Uuid>,
}
pub(crate) struct Plan {
    pub slide_id: Uuid,
    pub context: serde_json::Value,
    pub block_ids: Vec<Uuid>,
}
#[derive(Serialize)]
pub(crate) struct Slide {
    pub id: Uuid,
    pub position: i64,
    pub spec: Option<SlideSpec>,
    pub preview: bool,
}
pub(crate) struct RenderInput {
    pub specs: Vec<(Uuid, SlideSpec)>,
    pub template_sha256: Option<String>,
}
pub(crate) struct Rendered {
    pub output: crate::modules::assets::DerivedBlob,
    pub previews: Vec<crate::modules::assets::DerivedBlob>,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("자료 또는 발표자료를 찾을 수 없습니다.")]
    NotFound,
    #[error("입력이나 선택 상태가 바뀌었습니다. 최신 내용을 확인해 주세요.")]
    Conflict,
    #[error("목차와 근거를 확인하고 템플릿을 선택해 주세요.")]
    NotReady,
    #[error("제목은 120자, 추가 요청은 1,000자 이내로 입력하세요.")]
    Invalid,
    #[error("수정 요청은 2,000자 이내로 입력하고 수정할 범위를 선택하세요.")]
    EditInvalid,
    #[error("현재 생성 중인 작업이 있습니다. 완료하거나 취소한 뒤 다시 시도하세요.")]
    Busy,
    #[error("같은 요청에 다른 내용이 전달되었습니다.")]
    Idempotency,
    #[error("작업이 중단되었습니다. 완료한 내용은 보존됩니다.")]
    Cancelled,
    #[error("발표자료를 저장하거나 읽을 수 없습니다.")]
    Storage,
    #[error("발표자료를 만들지 못했습니다. 완료한 내용은 보존됩니다.")]
    Processing(&'static str),
}
pub(crate) fn now() -> i64 {
    crate::modules::documents::now()
}
#[derive(Serialize)]
pub(crate) struct Citation {
    pub block_id: Uuid,
    pub text: String,
    pub filename: String,
    pub page_id: Uuid,
    pub page_label: String,
    pub project_id: Uuid,
    pub item_id: Uuid,
    pub item_version: i64,
    pub file_version: i64,
    pub job_id: Uuid,
    pub available: bool,
}
