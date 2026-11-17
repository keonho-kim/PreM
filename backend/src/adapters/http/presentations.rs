// Purpose: Expose reviewed inputs, explicit PPT generation and project-scoped output access.
// Pattern: Typed commands, optimistic versions, idempotency and no-store output responses.
// Usage: Studio evidence/template/generation steps; all visitors share project state.
// Related: modules/presentations/, frontend/features/presentations/.
mod canvas;
mod editor_history;
mod references;
mod scope;
use crate::modules::presentations::{Design, EditRequest, Error, Generate, Presentations};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
pub(super) fn router(s: Presentations) -> Router {
    Router::new()
        .merge(editor_history::routes())
        .merge(canvas::routes())
        .merge(references::routes())
        .merge(scope::routes())
        .route(
            "/api/v1/projects/{p}/presentation-media",
            get(media)
                .post(upload_image)
                .layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route(
            "/api/v1/projects/{p}/presentation-media/{id}",
            get(media_image),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/edits",
            get(edits).post(edit),
        )
        .route(
            "/api/v1/projects/{p}/slide-edits/{id}/{action}",
            post(edit_command),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/evidence",
            get(citations),
        )
        .route(
            "/api/v1/projects/{p}/presentation-preparation",
            get(preparation),
        )
        .route(
            "/api/v1/projects/{p}/presentation-preparation/evidence",
            post(confirm),
        )
        .route(
            "/api/v1/projects/{p}/presentation-preparation/design",
            axum::routing::put(design),
        )
        .route("/api/v1/projects/{p}/presentations", get(runs).post(create))
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides",
            get(slides),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/download",
            get(download),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/preview",
            get(preview),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/{action}",
            post(command),
        )
        .layer(DefaultBodyLimit::max(32768))
        .with_state(s)
}
struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Conflict | Error::Busy | Error::Idempotency => StatusCode::CONFLICT,
            Error::Storage => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::UNPROCESSABLE_ENTITY,
        };
        json(
            status,
            serde_json::json!({"code":"presentation_error","message":self.0.to_string()}),
        )
    }
}
fn json(status: StatusCode, value: impl Serialize) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
fn body<T>(input: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    input.map(|Json(v)| v).map_err(|_| Error::Invalid.into())
}
fn key(h: &HeaderMap) -> Result<Uuid, ApiError> {
    h.get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or(Error::Invalid.into())
}
async fn preparation(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.preparation(p).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Confirm {
    fingerprint: String,
}
async fn confirm(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    i: Result<Json<Confirm>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.confirm(p, body(i)?.fingerprint).await?,
    ))
}
async fn design(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    i: Result<Json<Design>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.design(p, body(i)?).await?))
}
async fn create(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    h: HeaderMap,
    i: Result<Json<Generate>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.create(p, key(&h)?, body(i)?).await?,
    ))
}
async fn runs(State(s): State<Presentations>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.runs(p).await?))
}
async fn slides(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.slides(p, id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    expected_version: i64,
    editor_session_id: Option<Uuid>,
}
async fn command(
    State(s): State<Presentations>,
    Path((p, id, a)): Path<(Uuid, Uuid, String)>,
    h: HeaderMap,
    i: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.command(p, id, key(&h)?, body(i)?.expected_version, a)
            .await?,
    ))
}
async fn output(
    s: Presentations,
    p: Uuid,
    id: Uuid,
    slide: Option<Uuid>,
) -> Result<Response, ApiError> {
    let (reader, file) = s.file(p, id, slide).await?;
    let mut response = Body::from_stream(tokio_util::io::ReaderStream::new(reader)).into_response();
    let h = response.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        file.mime.parse().map_err(|_| ApiError(Error::Storage))?,
    );
    h.insert(header::CONTENT_LENGTH, file.size.into());
    h.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    h.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    if slide.is_none() {
        h.insert(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"PreM-{id}.pptx\"")
                .parse()
                .map_err(|_| ApiError(Error::Storage))?,
        );
    }
    Ok(response)
}
async fn download(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    output(s, p, id, None).await
}
async fn preview(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    output(s, p, id, Some(slide)).await
}

async fn citations(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.citations(p, id, slide).await?))
}

async fn edits(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.edits(p, id, slide).await?))
}
async fn edit(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
    h: HeaderMap,
    i: Result<Json<EditRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.edit(p, id, slide, key(&h)?, body(i)?).await?,
    ))
}
async fn edit_command(
    State(s): State<Presentations>,
    Path((p, id, action)): Path<(Uuid, Uuid, String)>,
    h: HeaderMap,
    i: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    let i = body(i)?;
    Ok(json(
        StatusCode::OK,
        s.edit_command(
            p,
            id,
            key(&h)?,
            i.expected_version,
            action,
            i.editor_session_id,
        )
        .await?,
    ))
}

async fn media(State(s): State<Presentations>, Path(p): Path<Uuid>) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.media(p).await?))
}
#[derive(Deserialize)]
struct ImageName {
    name: String,
}
async fn upload_image(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    Query(n): Query<ImageName>,
    h: HeaderMap,
    bytes: axum::body::Bytes,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::CREATED,
        s.upload_image(p, key(&h)?, n.name, bytes.to_vec()).await?,
    ))
}
async fn media_image(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let (reader, _file) = s.media_file(p, id).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Body::from_stream(tokio_util::io::ReaderStream::new(reader)),
    )
        .into_response())
}
