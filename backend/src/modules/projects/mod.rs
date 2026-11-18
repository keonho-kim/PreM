// Purpose: Own shared project identity, naming rules and use cases.
// Pattern: Domain values and a narrow persistence port behind a feature facade.
// Usage: HTTP adapts requests into this service; SQLite implements its store.
// Related: ports.rs, adapters/sqlite/projects.rs, adapters/http/projects.rs.
mod dates;
mod ports;
pub(crate) use ports::{ProjectStore, StoreFuture};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub(crate) struct Project {
    pub id: Uuid,
    pub name: String,
    pub due_date: Option<String>,
    pub status: String,
    pub deleted_at: Option<i64>,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub saved_stage: String,
}
#[derive(Clone)]
pub(crate) struct ListQuery {
    pub query: String,
    pub status: String,
    pub due_date: Option<String>,
    pub due_from: Option<String>,
    pub due_to: Option<String>,
    pub sort: String,
    pub limit: u32,
    pub offset: u32,
}
pub(crate) struct ProjectList {
    pub items: Vec<Project>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}
pub(crate) enum Change {
    Name(String),
    Status(String),
    Delete,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("프로젝트 이름은 앞뒤 공백을 제외한 1~80자이며 제어 문자를 포함할 수 없습니다.")]
    InvalidName,
    #[error("검색어 또는 페이지 범위가 올바르지 않습니다.")]
    InvalidQuery,
    #[error("마감일은 1900~9999년의 유효한 YYYY-MM-DD 날짜여야 합니다.")]
    InvalidDate,
    #[error("프로젝트를 찾을 수 없습니다.")]
    NotFound,
    #[error("프로젝트가 변경되었습니다. 최신 정보를 확인하고 다시 시도하세요.")]
    Conflict,
    #[error("같은 요청 키에 다른 이름이나 마감일을 사용할 수 없습니다.")]
    IdempotencyConflict,
    #[error("서버가 현재 요청을 처리할 수 없습니다. 잠시 후 다시 시도하세요.")]
    Unavailable,
    #[error("프로젝트를 저장하거나 조회하지 못했습니다.")]
    Storage,
}
pub(crate) struct CreateResult {
    pub project: Project,
    pub replayed: bool,
}
#[derive(Clone)]
pub(crate) struct ProjectService {
    store: Arc<dyn ProjectStore>,
}
impl ProjectService {
    pub fn new(store: Arc<dyn ProjectStore>) -> Self {
        Self { store }
    }
    pub async fn list(&self, query: ListQuery) -> Result<ProjectList, Error> {
        if query.query.chars().count() > 80
            || !(1..=100).contains(&query.limit)
            || query.offset > 1_000_000
            || !["active", "archived", "all"].contains(&query.status.as_str())
            || !["recent", "name", "deadline"].contains(&query.sort.as_str())
            || query.due_date.as_ref().is_some_and(|d| !dates::valid(d))
            || query.due_from.as_ref().is_some_and(|d| !dates::valid(d))
            || query.due_to.as_ref().is_some_and(|d| !dates::valid(d))
            || matches!((&query.due_from, &query.due_to), (Some(a), Some(b)) if a > b)
        {
            return Err(Error::InvalidQuery);
        }
        self.store.list(query).await
    }
    pub async fn get(&self, id: Uuid) -> Result<Project, Error> {
        self.store.get(id).await
    }
    pub async fn create(
        &self,
        name: String,
        due_date: String,
        key: Uuid,
    ) -> Result<CreateResult, Error> {
        let name = valid_name(name)?;
        if !dates::valid(&due_date) {
            return Err(Error::InvalidDate);
        }
        let now = now()?;
        self.store
            .create(
                Project {
                    id: Uuid::new_v4(),
                    name,
                    due_date: Some(due_date),
                    status: "active".to_owned(),
                    deleted_at: None,
                    version: 1,
                    created_at: now,
                    updated_at: now,
                    saved_stage: "created".into(),
                },
                key,
            )
            .await
    }
    pub async fn update(&self, id: Uuid, change: Change, version: i64) -> Result<Project, Error> {
        if version < 1 {
            return Err(Error::Conflict);
        }
        let change = match change {
            Change::Name(name) => Change::Name(valid_name(name)?),
            Change::Status(status) if ["active", "archived"].contains(&status.as_str()) => {
                Change::Status(status)
            }
            Change::Status(_) => return Err(Error::InvalidQuery),
            Change::Delete => Change::Delete,
        };
        self.store.update(id, change, version, now()?).await
    }
}
fn valid_name(value: String) -> Result<String, Error> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(Error::InvalidName);
    }
    Ok(name.to_owned())
}
fn now() -> Result<i64, Error> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::Storage)?;
    i64::try_from(elapsed.as_millis()).map_err(|_| Error::Storage)
}
