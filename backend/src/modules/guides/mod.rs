// Purpose: Own optional Do/Don't authoring and immutable project guide revisions.
// Pattern: Compare-and-set edits never regenerate existing document results.
// Usage: Studio's direction step saves a short human-authored guide.
// Related: adapters/sqlite/guides.rs, adapters/http/guides.rs.
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin, sync::Arc};
use uuid::Uuid;
#[derive(Serialize)]
pub(crate) struct Guide {
    pub version: i64,
    pub do_text: String,
    pub dont_text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Edit {
    pub expected_version: i64,
    pub do_text: String,
    pub dont_text: String,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("프로젝트를 찾을 수 없습니다.")]
    NotFound,
    #[error("작성 방향이 변경되었거나 프로젝트가 보관되었습니다. 최신 정보를 확인하세요.")]
    Conflict,
    #[error("작성 방향은 각 2,000자 이하로 입력하세요.")]
    Invalid,
    #[error("작성 방향을 저장하거나 읽을 수 없습니다.")]
    Storage,
}
pub(crate) type Work = Pin<Box<dyn Future<Output = Result<Guide, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn guide(&self, id: Uuid, edit: Option<Edit>) -> Work;
}
#[derive(Clone)]
pub(crate) struct Guides(Arc<dyn Store>);
impl Guides {
    pub fn new(store: Arc<dyn Store>) -> Self {
        Self(store)
    }
    pub async fn guide(&self, id: Uuid, edit: Option<Edit>) -> Result<Guide, Error> {
        if edit.as_ref().is_some_and(|e| {
            e.expected_version < 0
                || e.do_text.chars().count() > 2000
                || e.dont_text.chars().count() > 2000
        }) {
            return Err(Error::Invalid);
        }
        self.0.guide(id, edit).await
    }
}
