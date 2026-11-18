// Purpose: Define immutable extraction values, leased jobs and document API projections.
// Pattern: Domain records carry IDs and content, never SQL handles or process commands.
// Usage: Document service, worker and consuming adapters.
// Related: ports.rs, mod.rs, adapters/sqlite/documents/.
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct ExtractionProfiles {
    pub document: String,
    pub markdown: String,
}
impl ExtractionProfiles {
    pub fn for_format(&self, format: &str) -> &str {
        if format == "md" {
            &self.markdown
        } else {
            &self.document
        }
    }
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("자료 또는 처리 작업을 찾을 수 없습니다.")]
    NotFound,
    #[error("처리 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.")]
    Conflict,
    #[error("동일한 요청 키의 내용이 다릅니다.")]
    Idempotency,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("문서 저장소를 사용할 수 없습니다.")]
    Storage,
    #[error("{0}")]
    Processing(&'static str),
    #[error("작업이 중단되었습니다.")]
    Cancelled,
    #[error("문서 처리 설정을 기다리고 있습니다.")]
    WaitingConfiguration,
}
impl From<crate::modules::model_execution::Error> for Error {
    fn from(e: crate::modules::model_execution::Error) -> Self {
        match e {
            crate::modules::model_execution::Error::Cancelled => Self::Cancelled,
            other => Self::Processing(other.code()),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Job {
    pub id: Uuid,
    pub kind: String,
    pub item_id: Uuid,
    pub file_version: i64,
    pub source_sha256: String,
    pub format: String,
    pub profile: String,
    pub status: String,
    pub version: i64,
    pub attempt: i64,
    #[serde(skip_serializing)]
    pub lease: Option<String>,
    pub extraction_id: Option<Uuid>,
    pub config_id: Option<Uuid>,
    pub error_code: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub total_blocks: i64,
    pub completed_blocks: i64,
    pub steps: Vec<crate::workflows::engine::Stage>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Extracted {
    #[serde(default)]
    pub native: Option<super::NativePackage>,
    pub schema_version: i64,
    pub page_mode: String,
    pub warnings: Vec<String>,
    pub pages: Vec<ExtractedPage>,
    pub files: Vec<ExtractedFile>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExtractedPage {
    pub preview: Option<String>,
    pub source_page: Option<i64>,
    pub label: String,
    pub blocks: Vec<ExtractedBlock>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExtractedBlock {
    pub kind: String,
    pub text: String,
    pub attributes: serde_json::Value,
}
#[derive(Clone, Serialize)]
pub(crate) struct Block {
    pub id: Uuid,
    pub page_id: Uuid,
    pub position: i64,
    pub kind: String,
    pub text: String,
    pub attributes: serde_json::Value,
    pub is_table_of_contents: Option<i64>,
    pub image: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct Page {
    pub alignment: Option<super::PageAlignment>,
    pub preview: Option<String>,
    pub id: Uuid,
    pub ordinal: i64,
    pub source_page: Option<i64>,
    pub label: String,
    pub block_count: i64,
}
#[derive(Serialize)]
pub(crate) struct Detail {
    pub source_outline: Vec<super::SourceEntry>,
    pub reuse_ready: bool,
    pub template: Option<crate::modules::templates::Analysis>,
    pub template_extractable: bool,
    pub template_bundle: Option<String>,
    pub job: Job,
    pub pages: Vec<Page>,
    pub page_mode: Option<String>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Serialize)]
pub(crate) struct Settings {
    pub version: i64,
    pub connection_id: Option<Uuid>,
}
pub(crate) struct DecisionCommit {
    pub block_id: Uuid,
    pub value: i64,
    pub statistics: serde_json::Value,
    pub request_id: Uuid,
}
pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExtractedFile {
    pub sha256: String,
    pub size: u64,
}
