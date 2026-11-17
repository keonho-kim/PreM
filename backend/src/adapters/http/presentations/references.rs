// Purpose: Expose explicit immutable material insertion into the current deck revision.
// Pattern: Same project scope, version conditions and idempotency as generation/edit commands.
// Usage: Editor Reference gallery submits only server-issued job/material IDs.
// Related: modules/presentations/references.rs, material-insertion.tsx.
use super::*;
pub(super) fn routes() -> Router<Presentations> {
    Router::new()
        .route(
            "/api/v1/projects/{p}/presentations/{id}/slides/{slide}/materials",
            get(sources),
        )
        .route(
            "/api/v1/projects/{p}/presentations/{id}/materials",
            post(insert),
        )
}
async fn insert(
    State(s): State<Presentations>,
    Path((p, id)): Path<(Uuid, Uuid)>,
    h: HeaderMap,
    body: Result<Json<crate::modules::presentations::InsertMaterials>, JsonRejection>,
) -> Result<Response, ApiError> {
    let key = key(&h)?;
    let Json(i) = body.map_err(|_| ApiError(Error::EditInvalid))?;
    Ok(json(
        StatusCode::ACCEPTED,
        s.insert_materials(p, id, key, i).await?,
    ))
}

async fn sources(
    State(s): State<Presentations>,
    Path((p, r, slide)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    Ok(json(StatusCode::OK, s.material_sources(p, r, slide).await?))
}
