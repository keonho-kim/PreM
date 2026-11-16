// Purpose: Define product inference inputs, outputs and sanitized execution records.
// Pattern: Provider-neutral values, separate from HTTP DTOs and wire payloads.
// Usage: Execution, diagnostic scenarios and consuming I/O ports.
// Related: execution.rs, diagnostics.rs, ports.rs.
use crate::modules::model_registry;
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error(transparent)]
    Registry(#[from] model_registry::Error),
    #[error("모델 요청이 모두 사용 중입니다. 잠시 후 다시 시도하세요.")]
    Busy,
    #[error("대기 시간이 지나 요청을 시작하지 못했습니다. 잠시 후 다시 시도하세요.")]
    QueueTimeout,
    #[error("모델 응답 제한 시간을 초과했습니다. 모델 서버의 실행·로딩 상태를 확인하세요.")]
    Timeout,
    #[error("요청이 취소되었습니다.")]
    Cancelled,
    #[error("인증에 실패했습니다. API Key와 서버 설정을 확인하세요.")]
    Authentication,
    #[error("모델 서버가 요청을 거절했습니다 (HTTP {0}). 주소와 모델 ID를 확인하세요.")]
    Upstream(u16),
    #[error("모델 서버에 연결할 수 없습니다. 서버 주소와 실행 상태를 확인하세요.")]
    Network,
    #[error("응답 형식이 요청 조건과 맞지 않습니다. 모델 또는 서버의 기능 지원을 확인하세요.")]
    InvalidResponse,
    #[error("{0}")]
    Unsupported(&'static str),
    #[error("요청 이력을 저장할 수 없습니다. 다시 시도하세요.")]
    Storage,
}
impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Registry(_) => "configuration_error",
            Self::Busy => "provider_busy",
            Self::QueueTimeout => "provider_queue_timeout",
            Self::Timeout => "provider_timeout",
            Self::Cancelled => "cancelled",
            Self::Authentication => "provider_authentication",
            Self::Upstream(_) => "provider_http_error",
            Self::Network => "provider_unreachable",
            Self::InvalidResponse => "invalid_model_response",
            Self::Storage => "storage_unavailable",
            Self::Unsupported(_) => "unsupported_capability",
        }
    }
}
#[derive(Clone)]
pub(crate) struct RequestRecord {
    pub id: Uuid,
    pub config_id: Uuid,
    pub kind: String,
    pub status: String,
    pub elapsed_ms: Option<i64>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub error_code: Option<String>,
    pub created_at: i64,
}
