// Purpose: Define validated connection-level request limits and observable queue counts.
// Pattern: Independent operational settings preserve immutable model configuration revisions.
// Usage: Execution and SQLite share this contract; HTTP exposes only safe values.
// Related: admission.rs, adapters/sqlite/model_capacity.rs, V1__baseline.sql.
use super::Error;
use crate::modules::model_registry;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Limits {
    pub max_parallel: u32,
    pub queue_capacity: u32,
    pub queue_timeout_seconds: u32,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_parallel: 4,
            queue_capacity: 32,
            queue_timeout_seconds: 30,
        }
    }
}
impl Limits {
    pub fn validate(self) -> Result<Self, Error> {
        if !(1..=1024).contains(&self.max_parallel) {
            return Err(
                model_registry::Error::Invalid("동시 처리 수는 1~1024로 입력하세요.").into(),
            );
        }
        if self.queue_capacity > 4096 {
            return Err(model_registry::Error::Invalid(
                "대기 가능한 요청 수는 0~4096으로 입력하세요.",
            )
            .into());
        }
        if !(1..=600).contains(&self.queue_timeout_seconds) {
            return Err(
                model_registry::Error::Invalid("최대 대기 시간은 1~600초로 입력하세요.").into(),
            );
        }
        Ok(self)
    }
}
#[derive(Clone, Copy, Debug, Serialize)]
pub(crate) struct Capacity {
    pub connection_id: Uuid,
    pub version: i64,
    #[serde(flatten)]
    pub limits: Limits,
}
#[derive(Serialize)]
pub(crate) struct CapacityStatus {
    #[serde(flatten)]
    pub settings: Capacity,
    pub active: usize,
    pub queued: usize,
}
