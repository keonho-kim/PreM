// Purpose: Own shared reference/template registration, metadata and immutable file versions.
// Pattern: One cohesive library use case with a narrow atomic persistence port.
// Usage: Space HTTP maps transport to these commands; file bytes belong to assets.
// Related: ports.rs, adapters/sqlite/libraries/, migrations/V4__space_libraries.sql.
mod ports;
use crate::modules::assets::{self, Blob, Format};
pub(crate) use ports::{LibraryStore, StoreFuture};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Kind {
    Reference,
    Template,
    Source(Uuid),
}
impl Kind {
    pub fn parse(value: &str) -> Result<Self, Error> {
        match value {
            "references" => Ok(Self::Reference),
            "templates" => Ok(Self::Template),
            _ if value.starts_with("project-") => Uuid::parse_str(&value[8..])
                .map(Self::Source)
                .map_err(|_| Error::NotFound),
            _ => Err(Error::NotFound),
        }
    }
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Reference => "reference",
            Self::Template => "template",
            Self::Source(_) => "source",
        }
    }
    pub fn project(self) -> Option<Uuid> {
        if let Self::Source(id) = self {
            Some(id)
        } else {
            None
        }
    }
    pub fn validate_file(self, name: &str) -> Result<Format, Error> {
        let format = Format::from_filename(name)?;
        if self == Self::Template && format != Format::Pptx {
            return Err(Error::Validation(
                "템플릿은 PPTX 파일만 등록할 수 있습니다.",
            ));
        }
        Ok(format)
    }
}
#[derive(Clone, Debug)]
pub(crate) struct Item {
    pub kind: Kind,
    pub id: Uuid,
    pub title: String,
    pub tags: Vec<String>,
    pub status: String,
    pub version: i64,
    pub file_version: i64,
    pub filename: String,
    pub blob_sha256: String,
    pub size: u64,
    pub mime: String,
    pub format: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub processing: String,
}
pub(crate) struct FileVersion {
    pub number: i64,
    pub filename: String,
    pub blob_sha256: String,
    pub size: u64,
    pub mime: String,
    pub created_at: i64,
}
pub(crate) struct ListQuery {
    pub kind: Option<Kind>,
    pub q: String,
    pub status: String,
    pub limit: u32,
    pub offset: u32,
}
pub(crate) struct ItemList {
    pub items: Vec<Item>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}
#[derive(Clone, Debug)]
pub(crate) struct Upload {
    pub key: Uuid,
    pub attempt: Uuid,
    pub kind: Kind,
    pub target: Option<Uuid>,
    pub expected_version: Option<i64>,
}
pub(crate) struct Register {
    pub upload: Upload,
    pub title: String,
    pub tags: Vec<String>,
    pub filename: String,
    pub blob: Blob,
    pub now: i64,
}
pub(crate) struct Saved {
    pub item: Item,
    pub replayed: bool,
}
pub(crate) enum Change {
    Metadata { title: String, tags: Vec<String> },
    Status(String),
    Delete,
}
pub(crate) struct UploadStatus {
    pub state: String,
    pub item_id: Option<String>,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("{0}")]
    Validation(&'static str),
    #[error("자료를 찾을 수 없습니다.")]
    NotFound,
    #[error("다른 접속자가 자료를 변경했습니다. 최신 정보를 확인하고 다시 시도하세요.")]
    Conflict,
    #[error("동일한 요청 키의 내용이 다릅니다.")]
    IdempotencyConflict,
    #[error("업로드 취소 요청이 반영되었습니다.")]
    Cancelled,
    #[error("같은 업로드가 처리 중입니다. 잠시 후 상태를 확인하세요.")]
    InProgress,
    #[error("서버가 현재 요청을 처리할 수 없습니다. 다시 시도하세요.")]
    Unavailable,
    #[error("자료를 저장하거나 조회하지 못했습니다.")]
    Storage,
    #[error(transparent)]
    File(#[from] assets::Error),
}
#[derive(Clone)]
pub(crate) struct LibraryService {
    store: Arc<dyn LibraryStore>,
}
impl LibraryService {
    pub fn new(store: Arc<dyn LibraryStore>) -> Self {
        Self { store }
    }
    pub async fn list(&self, query: ListQuery) -> Result<ItemList, Error> {
        if query.q.chars().count() > 80
            || !(1..=100).contains(&query.limit)
            || query.offset > 1_000_000
            || !["active", "archived", "all"].contains(&query.status.as_str())
        {
            return Err(Error::Validation("검색 조건이 올바르지 않습니다."));
        }
        self.store.list(query).await
    }
    pub async fn get(&self, kind: Kind, id: Uuid) -> Result<Item, Error> {
        self.store.get(kind, id).await
    }
    pub async fn versions(&self, kind: Kind, id: Uuid) -> Result<Vec<FileVersion>, Error> {
        self.store.versions(kind, id).await
    }
    pub async fn begin(&self, upload: Upload) -> Result<(), Error> {
        if upload.target.is_some() && upload.expected_version.is_none_or(|v| v < 1) {
            return Err(Error::Validation("파일 교체에는 기준 버전이 필요합니다."));
        }
        self.store.begin(upload, now()?).await
    }
    pub async fn failed(&self, upload: Upload) {
        let _ = self.store.failed(upload).await;
    }
    pub async fn status(&self, key: Uuid) -> Result<UploadStatus, Error> {
        self.store.upload_status(key).await
    }
    pub async fn cancel(&self, key: Uuid) -> Result<UploadStatus, Error> {
        self.store.cancel(key, now()?).await
    }
    pub async fn register(&self, mut request: Register) -> Result<Saved, Error> {
        request.title = title(request.title)?;
        request.tags = tags(request.tags)?;
        request.upload.kind.validate_file(&request.filename)?;
        self.store.register(request).await
    }
    pub async fn change(
        &self,
        kind: Kind,
        id: Uuid,
        version: i64,
        change: Change,
    ) -> Result<Item, Error> {
        if version < 1 {
            return Err(Error::Conflict);
        }
        let change = match change {
            Change::Metadata { title: t, tags: ts } => Change::Metadata {
                title: title(t)?,
                tags: tags(ts)?,
            },
            Change::Status(s) if ["active", "archived"].contains(&s.as_str()) => Change::Status(s),
            Change::Status(_) => return Err(Error::Validation("자료 상태가 올바르지 않습니다.")),
            Change::Delete => Change::Delete,
        };
        self.store.change(kind, id, version, change, now()?).await
    }
}
fn title(value: String) -> Result<String, Error> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control) {
        return Err(Error::Validation("자료 이름은 1~120자로 입력하세요."));
    }
    Ok(value.into())
}
fn tags(values: Vec<String>) -> Result<Vec<String>, Error> {
    if values.len() > 12 {
        return Err(Error::Validation(
            "태그는 최대 12개까지 등록할 수 있습니다.",
        ));
    }
    let mut result = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > 24 || value.chars().any(char::is_control) {
            return Err(Error::Validation("태그는 각각 24자 이하로 입력하세요."));
        }
        if !result.iter().any(|v| v == value) {
            result.push(value.to_owned());
        }
    }
    result.sort();
    Ok(result)
}
pub(crate) fn now() -> Result<i64, Error> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Storage)?
            .as_millis(),
    )
    .map_err(|_| Error::Storage)
}
