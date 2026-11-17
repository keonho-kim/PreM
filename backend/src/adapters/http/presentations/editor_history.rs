// Purpose: Expose editor session cache lifetime, hold-comparison sources and bounded undo.
// Pattern: Project/deck scoped IDs are cache ownership, never an authentication layer.
// Usage: Mounted inside presentations routes; close accepts same-origin pagehide beacons.
// Related: modules/presentations/history.rs, use-editor-session.ts.
use super::*;
pub(super) fn routes() -> Router<Presentations> {
    Router::new()
        .route(
            "/api/v1/projects/{p}/presentations/{id}/history",
            get(history),
        )
        .route("/api/v1/projects/{p}/presentations/{id}/undo", post(undo))
        .route(
            "/api/v1/projects/{p}/presentations/{id}/editor-sessions",
            post(open),
        )
        .route(
            "/api/v1/projects/{p}/editor-sessions/{id}",
            axum::routing::patch(touch),
        )
        .route(
            "/api/v1/projects/{p}/editor-sessions/{id}/close",
            post(close),
        )
        .route(
            "/api/v1/projects/{p}/slide-edits/{id}/slides/{slide}/preview",
            get(preview),
        )
}
#[derive(Deserialize)]
struct SessionQuery {
    session_id: Option<Uuid>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Open {
    session_id: Uuid,
}
async fn history(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    Query(q): Query<SessionQuery>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.history(p, id, q.session_id).await?))
}
async fn undo(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    h: HeaderMap,
    i: Result<Json<Version>, JsonRejection>,
) -> Result<Response, ApiError> {
    let i = body(i)?;
    Ok(json(
        StatusCode::OK,
        s.undo(
            p,
            id,
            key(&h)?,
            i.expected_version,
            i.editor_session_id.ok_or(Error::HistoryUnavailable)?,
        )
        .await?,
    ))
}
async fn open(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    i: Result<Json<Open>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::CREATED,
        serde_json::json!({"id":s.open_editor(p,id,body(i)?.session_id).await?}),
    ))
}
async fn touch(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    s.touch_editor(p, id).await?;
    Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
}
async fn close(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    s.close_editor(p, id).await?;
    Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
}
async fn preview(
    State(s): State<Presentations>,
    Path((p, id, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let (reader, _) = s.edit_preview(p, id, slide).await?;
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
