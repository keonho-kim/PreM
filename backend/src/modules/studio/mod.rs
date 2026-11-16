// Purpose: Confirm immutable project source selections before presentation authoring.
// Pattern: Snapshot-based compare-and-set; visits never imply completion.
// Usage: Studio reads readiness and confirms exactly the source versions shown to the user.
// Related: adapters/sqlite/studio.rs, adapters/http/studio.rs.
use serde::Serialize;
use std::{future::Future, pin::Pin, sync::Arc};
use uuid::Uuid;
#[derive(Serialize)]
pub(crate) struct State {
    pub snapshot: String,
    pub ready: bool,
    pub confirmed: bool,
    pub count: usize,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("프로젝트를 찾을 수 없습니다.")]
    NotFound,
    #[error("원본 목록이 변경되었습니다. 새로고침 후 다시 확인하세요.")]
    Conflict,
    #[error("원본을 한 개 이상 등록하고 문서 준비가 끝난 뒤 확인하세요.")]
    NotReady,
    #[error("프로젝트 원본 상태를 저장하거나 조회할 수 없습니다.")]
    Storage,
}
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn state(&self, id: Uuid, confirm: Option<String>) -> Work<State>;
}
#[derive(Clone)]
pub(crate) struct Studio(Arc<dyn Store>);
impl Studio {
    pub fn new(store: Arc<dyn Store>) -> Self {
        Self(store)
    }
    pub async fn state(&self, id: Uuid, confirm: Option<String>) -> Result<State, Error> {
        self.0.state(id, confirm).await
    }
}
