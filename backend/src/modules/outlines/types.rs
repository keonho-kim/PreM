// Purpose: Define outline revisions, source links and explicit generation commands.
// Pattern: Canonical block IDs, immutable input identities and small typed projections.
// Usage: Outline facade, SQLite owner and HTTP/React boundary.
// Related: mod.rs, validation.rs, V1__baseline.sql.
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Node {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub description: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Assignment {
    pub node_id: Uuid,
    pub block_id: Uuid,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Draft {
    pub nodes: Vec<Node>,
    pub assignments: Vec<Assignment>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Edit {
    pub expected_version: i64,
    pub source_snapshot: String,
    pub guide_version: i64,
    pub draft: Draft,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Generate {
    pub expected_version: i64,
    pub source_snapshot: String,
    pub guide_version: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_version: Option<i64>,
    pub kind: String,
    #[serde(default)]
    pub node_ids: Vec<Uuid>,
}
#[derive(Clone, Serialize)]
pub(crate) struct Block {
    pub id: Uuid,
    pub source_version_id: Uuid,
    pub item_id: Uuid,
    pub file_version: i64,
    pub filename: String,
    pub page_id: Uuid,
    pub page_label: String,
    pub job_id: Uuid,
    pub kind: String,
    pub text: String,
    pub preview: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct Blocks {
    pub items: Vec<Block>,
    pub total: i64,
    pub offset: u32,
}
#[derive(Serialize)]
pub(crate) struct State {
    pub version: i64,
    pub revision_id: Option<Uuid>,
    pub source_snapshot: String,
    pub guide_version: i64,
    pub stale: bool,
    pub confirmed: bool,
    pub ready: bool,
    pub draft: Draft,
    pub run: Option<Run>,
}
#[derive(Serialize)]
pub(crate) struct Revision {
    pub id: Uuid,
    pub number: i64,
    pub origin: String,
    pub created_at: i64,
}
#[derive(Clone, Serialize)]
pub(crate) struct Run {
    pub id: Uuid,
    pub project_id: Uuid,
    pub kind: String,
    pub status: String,
    pub version: i64,
    pub total: i64,
    pub completed: i64,
    pub included_blocks: i64,
    pub total_blocks: i64,
    pub error_code: Option<String>,
    pub result_revision_id: Option<Uuid>,
    pub steps: Vec<crate::workflows::engine::Stage>,
    #[serde(skip)]
    pub config_id: Uuid,
    #[serde(skip)]
    pub lease: Option<String>,
}
pub(crate) struct Plan {
    pub batch: i64,
    pub context: serde_json::Value,
    pub blocks: Vec<(String, Uuid)>,
    pub nodes: Vec<(String, Uuid)>,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("프로젝트 또는 목차를 찾을 수 없습니다.")]
    NotFound,
    #[error("원본·작성 방향·목차 또는 AI 설정이 변경되었습니다. 최신 내용을 확인하세요.")]
    Conflict,
    #[error("원본 확인을 완료하고 저장한 작성 방향을 확인해 주세요.")]
    NotReady,
    #[error("목차는 두 단계로 1~24개, 제목 120자·설명 1,000자 이내로 작성하세요.")]
    Invalid,
    #[error("각 마지막 목차에 원문 내용을 하나 이상 연결해 주세요.")]
    Unmapped,
    #[error("자동으로 처리할 내용이 너무 많습니다. 프로젝트 문서를 나누어 준비해 주세요.")]
    Limit,
    #[error("동일한 요청 키에 다른 내용이 전달되었습니다.")]
    Idempotency,
    #[error("진행 중인 작업이 있습니다. 완료하거나 취소한 뒤 다시 시도하세요.")]
    Busy,
    #[error("작업이 취소되었습니다.")]
    Cancelled,
    #[error("AI 요청을 완료하지 못했습니다. 기존 목차는 유지됩니다.")]
    Model(&'static str),
    #[error("목차를 저장하거나 읽지 못했습니다.")]
    Storage,
}
pub(crate) fn now() -> i64 {
    crate::modules::documents::now()
}
