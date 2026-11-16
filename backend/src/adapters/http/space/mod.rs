// Purpose: Expose shared library metadata, versions and binary upload/download endpoints.
// Pattern: Narrow transport state; services own rules and adapters own persistence.
// Usage: Mounted under /api/v1/space by the HTTP composition root.
// Related: dto.rs, uploads.rs, modules/assets/, modules/libraries/.
mod dto;
mod metadata;
mod sources;
mod uploads;
use crate::modules::{
    assets::{AssetService, MAX_FILE_BYTES},
    libraries::*,
};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use metadata::{detail, download, remove, update, versions};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct SpaceApi {
    libraries: LibraryService,
    assets: AssetService,
    uploads: uploads::Registry,
}
impl SpaceApi {
    pub(crate) fn assets(&self) -> AssetService {
        self.assets.clone()
    }
    pub(crate) async fn shutdown(&self) -> anyhow::Result<()> {
        self.uploads.cancel_all();
        self.assets.shutdown().await?;
        Ok(())
    }
    pub(crate) fn cancel_uploads(&self) {
        self.uploads.cancel_all();
    }
    pub fn new(libraries: LibraryService, assets: AssetService) -> Self {
        Self {
            libraries,
            assets,
            uploads: Default::default(),
        }
    }
}
pub(super) fn router(state: SpaceApi) -> Router {
    Router::new()
        .merge(sources::routes())
        .route(
            "/api/v1/space/uploads/{key}",
            get(uploads::status).delete(uploads::cancel),
        )
        .route("/api/v1/space/{kind}", get(list).post(uploads::create))
        .route(
            "/api/v1/space/{kind}/{id}",
            get(detail)
                .patch(update)
                .delete(remove)
                .layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/api/v1/space/{kind}/{id}/versions",
            get(versions).post(uploads::replace),
        )
        .route("/api/v1/space/{kind}/{id}/download", get(download))
        .layer(DefaultBodyLimit::max((MAX_FILE_BYTES + 64 * 1024) as usize))
        .with_state(state)
}
fn json(status: StatusCode, value: impl Serialize) -> Response {
    let mut r = (status, Json(value)).into_response();
    r.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    r
}
fn failure(error: Error) -> Response {
    use crate::modules::assets::Error as FileError;
    let (status, code) = match &error {
        Error::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "validation_error"),
        Error::NotFound => (StatusCode::NOT_FOUND, "asset_not_found"),
        Error::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
        Error::IdempotencyConflict => (StatusCode::CONFLICT, "idempotency_conflict"),
        Error::Cancelled | Error::File(FileError::Cancelled) => {
            (StatusCode::CONFLICT, "upload_cancelled")
        }
        Error::InProgress => (StatusCode::CONFLICT, "upload_in_progress"),
        Error::Unavailable | Error::File(FileError::Busy) => {
            (StatusCode::SERVICE_UNAVAILABLE, "unavailable")
        }
        Error::Storage | Error::File(FileError::Storage) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "storage_error")
        }
        Error::File(FileError::TooLarge) => (StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"),
        Error::File(FileError::NoSpace) => {
            (StatusCode::INSUFFICIENT_STORAGE, "insufficient_storage")
        }
        Error::File(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_file"),
    };
    json(
        status,
        serde_json::json!({"code":code,"message":error.to_string()}),
    )
}
fn target(kind: &str, id: &str) -> Result<(Kind, Uuid), Error> {
    Ok((
        Kind::parse(kind)?,
        Uuid::parse_str(id).map_err(|_| Error::NotFound)?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Filters {
    #[serde(default)]
    q: String,
    #[serde(default = "active")]
    status: String,
    #[serde(default = "page_size")]
    limit: u32,
    #[serde(default)]
    offset: u32,
}
fn active() -> String {
    "active".into()
}
fn page_size() -> u32 {
    12
}
async fn list(
    State(s): State<SpaceApi>,
    Path(kind): Path<String>,
    query: Result<Query<Filters>, QueryRejection>,
) -> Response {
    let parsed = if kind == "all" {
        Ok(None)
    } else {
        Kind::parse(&kind).map(Some)
    };
    let (Ok(kind), Ok(Query(q))) = (parsed, query) else {
        return failure(Error::Validation(
            "자료 종류 또는 검색 조건이 올바르지 않습니다.",
        ));
    };
    match s
        .libraries
        .list(ListQuery {
            kind,
            q: q.q.trim().into(),
            status: q.status,
            limit: q.limit,
            offset: q.offset,
        })
        .await
    {
        Ok(v) => json(
            StatusCode::OK,
            serde_json::json!({"items":v.items.into_iter().map(dto::ItemDto::from).collect::<Vec<_>>(),"total":v.total,"limit":v.limit,"offset":v.offset}),
        ),
        Err(e) => failure(e),
    }
}
