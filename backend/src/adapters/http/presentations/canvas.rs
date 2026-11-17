// Purpose: Expose explicit blank creation and version-checked direct canvas writes.
// Pattern: Existing public project scope, typed bodies and idempotency; no privileged model transport.
// Usage: Studio manual entry and canvas controls; all mutations queue normal durable rendering.
// Related: modules/presentations/canvas.rs, frontend/canvas-api.ts, V30 migration.
use super::*;
use crate::modules::presentations::{BlankPresentation, CanvasCommand};
pub(super) fn routes() -> Router<Presentations> {
    Router::new()
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/layers",
            get(layers),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/layers/{layer}",
            get(layer),
        )
        .route("/api/v1/projects/{p}/presentation-layouts", get(layouts))
        .route("/api/v1/projects/{p}/presentations/blank", post(blank))
        .route(
            "/api/v1/projects/{p}/presentations/{id}/canvas",
            post(command),
        )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LayoutQuery {
    template_job_id: Option<Uuid>,
    run_id: Option<Uuid>,
}
async fn layouts(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    Query(q): Query<LayoutQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.canvas_layouts(p, q.template_job_id, q.run_id).await?,
    ))
}
async fn blank(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    h: HeaderMap,
    input: Result<Json<BlankPresentation>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.blank(p, key(&h)?, body(input)?).await?,
    ))
}
async fn command(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    h: HeaderMap,
    input: Result<Json<CanvasCommand>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::ACCEPTED,
        s.canvas(p, id, key(&h)?, body(input)?).await?,
    ))
}

async fn layers(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.layers(p, id, slide).await?))
}
async fn layer(
    State(s): State<Presentations>,
    Path((p, id, slide, key)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Response, ApiError> {
    let (reader, file) = s.layer_file(p, id, slide, key).await?;
    Ok((
        [
            (header::CONTENT_TYPE, file.mime),
            (header::CACHE_CONTROL, "private, no-store"),
        ],
        Body::from_stream(tokio_util::io::ReaderStream::new(reader)),
    )
        .into_response())
}
