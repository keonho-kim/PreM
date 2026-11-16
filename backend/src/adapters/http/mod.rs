// Purpose: Route the embedded frontend, health and shared project API.
// Pattern: Transport composition with narrow feature state and JSON API errors.
// Usage: Composed by Application::router after persistent storage is ready.
// Related: frontend.rs, projects.rs, app/mod.rs.
mod admin_access;
mod authoring_models;
mod decisions;
pub(crate) use admin_access::AdminAccess;
mod documents;
mod frontend;
mod health;
mod model_capacity;
mod model_discovery;
mod outlines;
mod presentations;
mod projects;
mod provider_catalog;
mod providers;
mod relations;
mod search;
pub(crate) use providers::ProviderApi;
mod guides;
mod space;
mod studio;
use crate::modules::projects::ProjectService;
use axum::{Json, Router, http::StatusCode, response::Redirect, routing::get};
pub(crate) use space::SpaceApi;
use tower_http::trace::TraceLayer;
pub(crate) struct WorkspaceApi {
    pub admin_access: AdminAccess,
    pub studio: crate::modules::studio::Studio,
    pub guides: crate::modules::guides::Guides,
    pub relations: crate::modules::relations::Relations,
    pub search: crate::modules::search::Search,
    pub presentations: crate::modules::presentations::Presentations,
    pub outlines: crate::modules::outlines::Outlines,
}
pub(crate) fn router(
    service: ProjectService,
    space: SpaceApi,
    providers: ProviderApi,
    documents: crate::modules::documents::Documents,
    assets: crate::modules::assets::AssetService,
    authoring: WorkspaceApi,
) -> Router {
    let access = authoring.admin_access;
    Router::new()
        .merge(admin_access::settings_router(access.clone()))
        .route("/api/v1/admin/access", axum::routing::post(admin_access::verify))
        .route("/", get(|| async { Redirect::temporary("/home") }))
        .route("/healthz", get(|| async { Json(health::Health::default()) }))
        .route("/home", get(frontend::serve))
        .route("/home/", get(frontend::serve))
        .route("/home/{*path}", get(frontend::serve))
        .merge(projects::router(service))
        .merge(studio::router(authoring.studio))
        .merge(guides::router(authoring.guides))
        .merge(relations::router(authoring.relations))
        .merge(search::router(authoring.search))
        .merge(outlines::router(authoring.outlines))
        .merge(presentations::router(authoring.presentations))
        .merge(space::router(space))
        .merge(providers::router(providers))
        .merge(documents::router(documents,assets))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(serde_json::json!({"code":"not_found","message":"The requested resource does not exist."}))) })
        .layer(axum::middleware::from_fn_with_state(access, admin_access::guard))
        .layer(TraceLayer::new_for_http())
}
