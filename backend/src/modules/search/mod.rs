// Purpose: Own shared document discovery independently of uploads and model-assisted comparisons.
// Pattern: Read-only search contract; source membership and excerpts come from canonical storage.
// Usage: Global search page submits an explicit query and URL-owned filters.
// Related: adapters/sqlite/search.rs, adapters/http/search.rs.
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin, sync::Arc};
#[derive(Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Query {
    pub q: String,
    pub scope: String,
    pub mode: String,
    pub archived: bool,
    pub offset: u32,
}
impl Default for Query {
    fn default() -> Self {
        Self {
            q: String::new(),
            scope: "all".into(),
            mode: "all".into(),
            archived: false,
            offset: 0,
        }
    }
}
#[derive(Serialize)]
pub(crate) struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub filename: String,
    pub format: String,
    pub file_version: i64,
    pub updated_at: i64,
    pub job_id: Option<String>,
    pub page_id: Option<String>,
    pub page_label: Option<String>,
    pub preview: Option<String>,
    pub excerpt: String,
    pub name_match: bool,
    pub content_match: bool,
}
#[derive(Serialize)]
pub(crate) struct Results {
    pub items: Vec<Item>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("검색어는 120자 이내로 입력하고 검색 범위를 확인해 주세요.")]
    Invalid,
    #[error("검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.")]
    Storage,
}
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn search(&self, q: Query) -> Work<Results>;
}
#[derive(Clone)]
pub(crate) struct Search(Arc<dyn Store>);
impl Search {
    pub fn new(store: Arc<dyn Store>) -> Self {
        Self(store)
    }
    pub async fn find(&self, mut q: Query) -> Result<Results, Error> {
        q.q = q.q.trim().to_owned();
        if q.q.chars().count() > 120
            || q.q.chars().any(char::is_control)
            || q.offset > 100000
            || !["all", "references", "templates"].contains(&q.scope.as_str())
            || !["all", "files", "content"].contains(&q.mode.as_str())
        {
            return Err(Error::Invalid);
        }
        if q.q.is_empty() {
            return Ok(Results {
                items: vec![],
                total: 0,
                offset: 0,
                limit: 12,
            });
        }
        self.0.search(q).await
    }
}
