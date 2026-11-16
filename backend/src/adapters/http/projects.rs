// Purpose: Expose validated JSON endpoints for a shared project directory.
// Pattern: HTTP DTOs map to feature commands; errors never reveal database internals.
// Usage: Mounted under /api/v1/projects by the HTTP composition root.
// Related: modules/projects/mod.rs, dev-docs/04-data-api.md.
use crate::modules::projects::{Change, Error, ListQuery, Project, ProjectService};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(super) fn router(service: ProjectService) -> Router {
    Router::new()
        .route("/api/v1/projects", get(list).post(create))
        .route(
            "/api/v1/projects/{id}",
            get(detail).patch(update).delete(remove),
        )
        .layer(DefaultBodyLimit::max(4096))
        .with_state(service)
}
#[derive(Serialize)]
struct ProjectDto {
    id: String,
    name: String,
    due_date: Option<String>,
    // Response alias for clients compiled against the previous v1 DTO.
    end_date: Option<String>,
    status: String,
    deleted_at: Option<i64>,
    version: i64,
    created_at: i64,
    updated_at: i64,
}
impl From<Project> for ProjectDto {
    fn from(p: Project) -> Self {
        Self {
            id: p.id.to_string(),
            name: p.name,
            end_date: p.due_date.clone(),
            due_date: p.due_date,
            status: p.status,
            deleted_at: p.deleted_at,
            version: p.version,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListParams {
    #[serde(default)]
    q: String,
    #[serde(default = "active")]
    status: String,
    #[serde(default = "recent")]
    sort: String,
    due_date: Option<String>,
    // Legacy range query parameters are transport compatibility only.
    from: Option<String>,
    to: Option<String>,
    #[serde(default = "default_limit")]
    limit: u32,
    #[serde(default)]
    offset: u32,
}
fn active() -> String {
    "active".into()
}
fn recent() -> String {
    "recent".into()
}
fn default_limit() -> u32 {
    50
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateBody {
    name: String,
    #[serde(alias = "end_date")]
    due_date: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateBody {
    name: Option<String>,
    status: Option<String>,
    expected_version: i64,
}
fn json(status: StatusCode, value: impl Serialize) -> Response {
    let mut response = (status, Json(value)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}
fn failure(status: StatusCode, code: &'static str, message: &str) -> Response {
    json(status, serde_json::json!({"code":code,"message":message}))
}
fn error(error: Error) -> Response {
    let (status, code) = match error {
        Error::InvalidName | Error::InvalidQuery | Error::InvalidDate => {
            (StatusCode::UNPROCESSABLE_ENTITY, "validation_error")
        }
        Error::NotFound => (StatusCode::NOT_FOUND, "project_not_found"),
        Error::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
        Error::IdempotencyConflict => (StatusCode::CONFLICT, "idempotency_conflict"),
        Error::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
        Error::Storage => (StatusCode::INTERNAL_SERVER_ERROR, "storage_error"),
    };
    failure(status, code, &error.to_string())
}
fn invalid_json(rejection: JsonRejection) -> Response {
    failure(
        rejection.status(),
        "invalid_request",
        "JSON 형식과 필수 입력 값을 확인하세요.",
    )
}
async fn list(
    State(service): State<ProjectService>,
    query: Result<Query<ListParams>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return failure(
            StatusCode::BAD_REQUEST,
            "invalid_query",
            "검색 조건이 올바르지 않습니다.",
        );
    };
    match service
        .list(ListQuery {
            query: query.q.trim().to_owned(),
            status: query.status,
            sort: query.sort,
            due_date: query.due_date,
            due_from: query.from,
            due_to: query.to,
            limit: query.limit,
            offset: query.offset,
        })
        .await
    {
        Ok(list) => json(
            StatusCode::OK,
            serde_json::json!({"items":list.items.into_iter().map(ProjectDto::from).collect::<Vec<_>>(),"total":list.total,"limit":list.limit,"offset":list.offset}),
        ),
        Err(e) => error(e),
    }
}
async fn detail(State(service): State<ProjectService>, Path(id): Path<String>) -> Response {
    let Ok(id) = Uuid::parse_str(&id) else {
        return error(Error::NotFound);
    };
    match service.get(id).await {
        Ok(p) => json(StatusCode::OK, ProjectDto::from(p)),
        Err(e) => error(e),
    }
}
async fn create(
    State(service): State<ProjectService>,
    headers: HeaderMap,
    body: Result<Json<CreateBody>, JsonRejection>,
) -> Response {
    let key = headers
        .get("idempotency-key")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| Uuid::parse_str(h).ok());
    let Some(key) = key else {
        return failure(
            StatusCode::BAD_REQUEST,
            "invalid_request_key",
            "UUID 형식의 Idempotency-Key가 필요합니다.",
        );
    };
    let body = match body {
        Ok(Json(body)) => body,
        Err(e) => return invalid_json(e),
    };
    match service.create(body.name, body.due_date, key).await {
        Ok(result) => json(
            if result.replayed {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            ProjectDto::from(result.project),
        ),
        Err(e) => error(e),
    }
}
async fn update(
    State(service): State<ProjectService>,
    Path(id): Path<String>,
    body: Result<Json<UpdateBody>, JsonRejection>,
) -> Response {
    let Ok(id) = Uuid::parse_str(&id) else {
        return error(Error::NotFound);
    };
    let body = match body {
        Ok(Json(body)) => body,
        Err(e) => return invalid_json(e),
    };
    let change = match (body.name, body.status) {
        (Some(name), None) => Change::Name(name),
        (None, Some(status)) => Change::Status(status),
        _ => return error(Error::InvalidQuery),
    };
    match service.update(id, change, body.expected_version).await {
        Ok(p) => json(StatusCode::OK, ProjectDto::from(p)),
        Err(e) => error(e),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteBody {
    expected_version: i64,
}
async fn remove(
    State(service): State<ProjectService>,
    Path(id): Path<String>,
    body: Result<Json<DeleteBody>, JsonRejection>,
) -> Response {
    let Ok(id) = Uuid::parse_str(&id) else {
        return error(Error::NotFound);
    };
    let body = match body {
        Ok(Json(body)) => body,
        Err(e) => return invalid_json(e),
    };
    match service
        .update(id, Change::Delete, body.expected_version)
        .await
    {
        Ok(p) => json(StatusCode::OK, ProjectDto::from(p)),
        Err(e) => error(e),
    }
}
