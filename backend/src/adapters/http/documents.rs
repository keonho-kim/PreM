// Purpose: Expose version-bound processing results, commands, settings and passive binary previews.
// Pattern: Thin HTTP boundary with idempotency/CAS commands and ownership-checked artifact reads.
// Usage: Space processing details and Admin's document model selection.
// Related: modules/documents/, modules/templates/, frontend/features/document-processing/.
use crate::modules::{
    assets::AssetService,
    documents::{Documents, Error},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone)]
struct Api {
    documents: Documents,
    assets: AssetService,
}
pub(super) fn router(documents: Documents, assets: AssetService) -> Router {
    Router::new()
        .route(
            "/api/v1/projects/{project}/files/{file}/processing",
            get(source_detail).post(source_enqueue),
        )
        .route(
            "/api/v1/projects/{project}/files/{file}/processing/history",
            get(source_history),
        )
        .route(
            "/api/v1/space/{kind}/{id}/processing",
            get(detail).post(enqueue),
        )
        .route("/api/v1/space/{kind}/{id}/processing/history", get(history))
        .route("/api/v1/document-jobs/{id}/blocks", get(blocks))
        .route("/api/v1/document-jobs/{id}/materials", get(materials))
        .route(
            "/api/v1/document-jobs/{id}/materials/resolve",
            axum::routing::post(resolve_materials),
        )
        .route("/api/v1/document-jobs/{id}/files/{hash}", get(artifact))
        .route(
            "/api/v1/document-jobs/{id}/{action}",
            axum::routing::post(command),
        )
        .route(
            "/api/v1/admin/document-processing/settings",
            get(settings).put(save_settings),
        )
        .layer(DefaultBodyLimit::max(4096))
        .with_state(Api { documents, assets })
}
fn json(status: StatusCode, data: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(data)).into_response()
}
struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self.0 {
            Error::NotFound => (StatusCode::NOT_FOUND, "processing_not_found"),
            Error::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
            Error::Idempotency => (StatusCode::CONFLICT, "idempotency_conflict"),
            Error::Invalid(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input"),
            _ => (StatusCode::SERVICE_UNAVAILABLE, "processing_unavailable"),
        };
        json(
            status,
            serde_json::json!({"code":code,"message":self.0.to_string()}),
        )
    }
}
fn key(h: &HeaderMap) -> Result<Uuid, ApiError> {
    h.get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| Error::Invalid("UUID Idempotency-Key가 필요합니다.").into())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    expected_version: i64,
}
#[derive(Deserialize)]
struct DetailQuery {
    job: Option<Uuid>,
}
async fn detail(
    State(s): State<Api>,
    Path((kind, id)): Path<(String, Uuid)>,
    Query(q): Query<DetailQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.documents.detail(kind, id, q.job).await?,
    ))
}
#[derive(Deserialize)]
struct HistoryQuery {
    file_version: Option<i64>,
}
async fn history(
    State(s): State<Api>,
    Path((kind, id)): Path<(String, Uuid)>,
    q: Query<HistoryQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.documents.history(kind, id, q.file_version).await?,
    ))
}
async fn enqueue(
    State(s): State<Api>,
    Path((kind, id)): Path<(String, Uuid)>,
    h: HeaderMap,
    body: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body
        .map_err(|_| Error::Invalid("요청 형식을 확인하세요."))?
        .0;
    Ok(json(
        StatusCode::ACCEPTED,
        s.documents
            .enqueue(kind, id, b.expected_version, key(&h)?)
            .await?,
    ))
}
async fn command(
    State(s): State<Api>,
    Path((id, action)): Path<(Uuid, String)>,
    h: HeaderMap,
    body: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body
        .map_err(|_| Error::Invalid("요청 형식을 확인하세요."))?
        .0;
    Ok(json(
        StatusCode::OK,
        s.documents
            .command(id, b.expected_version, key(&h)?, action)
            .await?,
    ))
}
#[derive(Deserialize, Default)]
struct BlockQuery {
    page: Option<Uuid>,
    #[serde(default)]
    q: String,
    #[serde(default)]
    offset: u32,
}
async fn blocks(
    State(s): State<Api>,
    Path(id): Path<Uuid>,
    Query(q): Query<BlockQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.documents.blocks(id, q.page, q.q, q.offset).await?,
    ))
}
async fn settings(State(s): State<Api>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.documents.settings().await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveSettings {
    expected_version: i64,
    connection_id: Option<Uuid>,
}
async fn save_settings(
    State(s): State<Api>,
    body: Result<Json<SaveSettings>, JsonRejection>,
) -> Result<Response, ApiError> {
    let b = body
        .map_err(|_| Error::Invalid("요청 형식을 확인하세요."))?
        .0;
    Ok(json(
        StatusCode::OK,
        s.documents
            .save_settings(b.expected_version, b.connection_id)
            .await?,
    ))
}
async fn artifact(
    State(s): State<Api>,
    Path((id, hash)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    let (mut mime, mut size) = s.documents.artifact(id, hash.clone()).await?;
    let file = if mime == crate::modules::assets::PACKAGE_MIME {
        let (reader, archive_size) = s.assets.archive(hash).await.map_err(|_| Error::Storage)?;
        mime = "application/zip".into();
        size = archive_size;
        reader
    } else {
        s.assets.read(hash).await.map_err(|_| Error::Storage)?
    };
    let mut r =
        axum::body::Body::from_stream(tokio_util::io::ReaderStream::new(file)).into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        mime.parse().map_err(|_| Error::Storage)?,
    );
    r.headers_mut().insert(header::CONTENT_LENGTH, size.into());
    r.headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    r.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        "default-src 'none'; sandbox".parse().unwrap(),
    );
    if mime == "application/zip" {
        r.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            "attachment; filename=source-assets.zip".parse().unwrap(),
        );
    }
    r.headers_mut().insert(
        header::CACHE_CONTROL,
        "private, max-age=3600".parse().unwrap(),
    );
    Ok(r)
}

#[derive(Deserialize)]
struct MaterialQuery {
    page: Option<Uuid>,
    kind: Option<String>,
    #[serde(default)]
    q: String,
    #[serde(default)]
    offset: u32,
}
async fn materials(
    State(s): State<Api>,
    Path(id): Path<Uuid>,
    Query(q): Query<MaterialQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.documents
            .materials(
                id,
                q.page,
                q.kind.unwrap_or_else(|| "all".into()),
                q.q,
                q.offset,
                None,
            )
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MaterialSelection {
    material_ids: Vec<Uuid>,
}
async fn resolve_materials(
    State(s): State<Api>,
    Path(id): Path<Uuid>,
    input: Result<Json<MaterialSelection>, JsonRejection>,
) -> Result<Response, ApiError> {
    let selected = input
        .map_err(|_| Error::Invalid("자료 선택을 확인하세요."))?
        .0;
    Ok(json(
        StatusCode::OK,
        s.documents
            .materials(
                id,
                None,
                "all".into(),
                String::new(),
                0,
                Some(selected.material_ids),
            )
            .await?,
    ))
}

async fn source_detail(
    s: State<Api>,
    Path((project, file)): Path<(Uuid, Uuid)>,
    q: Query<DetailQuery>,
) -> Result<Response, ApiError> {
    detail(s, Path((format!("project-{project}"), file)), q).await
}
async fn source_history(
    s: State<Api>,
    Path((project, file)): Path<(Uuid, Uuid)>,
    q: Query<HistoryQuery>,
) -> Result<Response, ApiError> {
    history(s, Path((format!("project-{project}"), file)), q).await
}
async fn source_enqueue(
    s: State<Api>,
    Path((project, file)): Path<(Uuid, Uuid)>,
    h: HeaderMap,
    b: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    enqueue(s, Path((format!("project-{project}"), file)), h, b).await
}
