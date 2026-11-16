// Purpose: Expose the server-owned provider catalog to Admin without duplicating rules.
// Pattern: HTTP projection of model_registry descriptors; contains no saved credentials.
// Usage: GET /api/v1/admin/llm/provider-types.
// Related: modules/model_registry/kind.rs, providers.rs, frontend/features/providers/api.ts.
use crate::modules::model_registry::{ProviderDescriptor, ProviderKind};
use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::Serialize;
#[derive(Serialize)]
struct Entry {
    category: &'static str,
    id: &'static str,
    label: &'static str,
    protocol: &'static str,
    base: &'static str,
    model: &'static str,
    structured: bool,
    key: bool,
    structured_reason: Option<&'static str>,
}
impl From<ProviderDescriptor> for Entry {
    fn from(d: ProviderDescriptor) -> Self {
        Self {
            category: d.category,
            id: d.id,
            label: d.label,
            protocol: d.protocol,
            base: d.base,
            model: d.model,
            structured: d.structured,
            key: d.key,
            structured_reason: d.structured_reason,
        }
    }
}
pub(super) async fn list() -> impl IntoResponse {
    (
        StatusCode::OK,
        [("Cache-Control", "no-store")],
        Json(
            ProviderKind::ALL
                .iter()
                .map(|kind| Entry::from(kind.descriptor()))
                .collect::<Vec<_>>(),
        ),
    )
}
