// Purpose: Expose the read-only outline scope for the currently reviewed presentation design.
// Pattern: Typed project/design identity and no-store responses; no new work is queued.
// Usage: Studio's generation scope checkbox group.
// Related: modules/presentations/selection.rs, generation-scope.tsx.
use super::*;
pub(super) fn routes() -> Router<Presentations> {
    Router::new().route(
        "/api/v1/projects/{p}/presentation-preparation/sections",
        get(read),
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScopeQuery {
    design_id: Uuid,
}
async fn read(
    State(s): State<Presentations>,
    Path(p): Path<Uuid>,
    Query(q): Query<ScopeQuery>,
) -> Result<Response, ApiError> {
    Ok(json(
        StatusCode::OK,
        s.generation_scope(p, q.design_id).await?,
    ))
}
