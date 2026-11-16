// Purpose: Define versioned search inputs, relation results and canonical source identities.
// Pattern: Compact projections and references; the worker never persists document text copies.
// Usage: Relations facade, persistence port and HTTP adapter.
// Related: mod.rs, worker.rs, V14__related_documents.sql.
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(crate) struct Options {
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub previous_versions: bool,
    pub source_project: Option<Uuid>,
    pub format: Option<String>,
    pub since: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Search {
    pub query: String,
    #[serde(default)]
    pub options: Options,
}
#[derive(Clone, Serialize)]
pub(crate) struct Run {
    pub id: Uuid,
    pub project_id: Uuid,
    pub query: String,
    pub options: Options,
    pub status: String,
    pub version: i64,
    pub total: i64,
    pub completed: i64,
    pub cache_hits: i64,
    pub stale: bool,
    pub exploration: Option<Exploration>,
    pub error_code: Option<String>,
    pub created_at: i64,
    #[serde(skip)]
    pub config: Option<Uuid>,
    #[serde(skip)]
    pub lease: Option<String>,
    #[serde(skip)]
    pub deadline: Option<i64>,
}
#[derive(Clone, Serialize)]
pub(crate) struct Origin {
    pub source_version_id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    pub item_id: Uuid,
    pub item_version: i64,
    pub file_version: i64,
    pub filename: String,
    pub job_id: Uuid,
    pub available: bool,
}
#[derive(Serialize)]
pub(crate) struct ResultItem {
    pub evidence_version: i64,
    pub id: Uuid,
    pub kind: String,
    pub relation: Option<i64>,
    pub excerpt: String,
    pub page_label: String,
    pub page_id: Uuid,
    pub preview: Option<String>,
    pub origins: Vec<Origin>,
    pub origin_count: i64,
    pub project_count: i64,
    pub selection_id: String,
    pub selection_version: i64,
    pub selected: bool,
}
#[derive(Serialize)]
pub(crate) struct Results {
    pub total: i64,
    pub items: Vec<ResultItem>,
    pub offset: u32,
}
#[derive(Clone)]
pub(crate) struct Candidate {
    pub id: Uuid,
    pub extraction: String,
    pub block: Option<String>,
    pub text: String,
    pub kind: String,
    pub read_ids: Vec<String>,
}
pub(crate) struct Plan {
    pub context: serde_json::Value,
    pub candidates: Vec<Candidate>,
}
pub(crate) struct Assessment {
    pub candidate: Uuid,
    pub key: String,
    pub context_hash: String,
    pub relation: i64,
    pub statistics: serde_json::Value,
    pub request_id: Uuid,
}
#[derive(Clone, Serialize)]
pub(crate) struct Settings {
    pub version: i64,
    pub connection_id: Option<Uuid>,
    pub planner_connection_id: Option<Uuid>,
}
#[derive(Serialize)]
pub(crate) struct Selection {
    pub id: String,
    pub version: i64,
    pub active: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SelectItem {
    pub candidate_id: Uuid,
    pub source_version_id: Uuid,
    pub expected_version: i64,
    pub selected: bool,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("프로젝트 또는 자료를 찾을 수 없습니다.")]
    NotFound,
    #[error("원본이나 저장 상태가 변경되었습니다. 최신 내용을 확인해 주세요.")]
    Conflict,
    #[error("같은 요청 키의 내용이 다릅니다.")]
    Idempotency,
    #[error("원본 문서가 준비된 뒤 자료를 찾아주세요.")]
    NotReady,
    #[error("현재 자료 찾기 요청이 많습니다. 잠시 후 다시 시도하세요.")]
    Busy,
    #[error("현재 자료 찾기는 프로젝트 원본 256개까지 지원합니다.")]
    SourceLimit,
    #[error("참고 자료는 프로젝트당 100개까지 선택할 수 있습니다.")]
    SelectionLimit,
    #[error("검색 조건을 확인하세요.")]
    Invalid,
    #[error("자료 찾기를 처리하지 못했습니다. 다시 시도해 주세요.")]
    Storage,
    #[error("작업이 중단되었습니다.")]
    Cancelled,
    #[error("{0}")]
    Model(&'static str),
}
pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone, Serialize)]
pub(crate) struct Exploration {
    pub phase: String,
    pub round: i64,
    pub read_blocks: i64,
    pub added_candidates: i64,
    pub unresolved: i64,
    pub stop_reason: Option<String>,
}
pub(crate) struct Discovery {
    pub context: serde_json::Value,
    pub queries: Vec<String>,
    pub planner: Option<Uuid>,
}
pub(crate) enum Next {
    Compare,
    Discover(Discovery),
    Complete,
}
#[derive(Serialize)]
pub(crate) struct EvidenceRead {
    pub origin: Origin,
    pub comparison: bool,
    pub block_id: Uuid,
    pub page_id: Uuid,
    pub page_label: String,
    pub text: String,
    pub truncated: bool,
}
