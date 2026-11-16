// Purpose: Bind project-original URLs to the shared, scope-aware registration transport.
// Pattern: Project identity is encoded in the typed registration kind before storage access.
// Usage: Studio uses these routes; Space all/reference/template listings never include originals.
// Related: mod.rs, metadata.rs, uploads.rs, modules/libraries/.
use super::*;
use axum::{
    extract::{Multipart, multipart::MultipartRejection},
    http::HeaderMap,
};
fn kind(id: Uuid) -> String {
    format!("project-{id}")
}
pub(super) fn routes() -> Router<SpaceApi> {
    Router::new()
        .route(
            "/api/v1/projects/{project}/files",
            get(list_sources).post(create),
        )
        .route(
            "/api/v1/projects/{project}/files/{id}",
            get(detail_source)
                .delete(remove_source)
                .layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/api/v1/projects/{project}/files/{id}/versions",
            get(versions_source).post(replace),
        )
        .route(
            "/api/v1/projects/{project}/files/{id}/download",
            get(download_source),
        )
}
async fn list_sources(
    s: State<SpaceApi>,
    Path(project): Path<Uuid>,
    q: Result<Query<Filters>, QueryRejection>,
) -> Response {
    list(s, Path(kind(project)), q).await
}
async fn create(
    s: State<SpaceApi>,
    Path(project): Path<Uuid>,
    h: HeaderMap,
    b: Result<Multipart, MultipartRejection>,
) -> Response {
    uploads::create(s, Path(kind(project)), h, b).await
}
async fn replace(
    s: State<SpaceApi>,
    Path((project, id)): Path<(Uuid, String)>,
    h: HeaderMap,
    b: Result<Multipart, MultipartRejection>,
) -> Response {
    uploads::replace(s, Path((kind(project), id)), h, b).await
}
async fn detail_source(s: State<SpaceApi>, Path((project, id)): Path<(Uuid, String)>) -> Response {
    detail(s, Path((kind(project), id))).await
}
async fn versions_source(
    s: State<SpaceApi>,
    Path((project, id)): Path<(Uuid, String)>,
) -> Response {
    versions(s, Path((kind(project), id))).await
}
async fn download_source(
    s: State<SpaceApi>,
    Path((project, id)): Path<(Uuid, String)>,
    q: Result<Query<metadata::Download>, QueryRejection>,
) -> Response {
    download(s, Path((kind(project), id)), q).await
}
async fn remove_source(
    s: State<SpaceApi>,
    Path((project, id)): Path<(Uuid, String)>,
    b: Result<Json<metadata::Delete>, JsonRejection>,
) -> Response {
    remove(s, Path((kind(project), id)), b).await
}
