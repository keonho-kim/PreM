// Purpose: Declare implemented product features.
// Pattern: Feature facades expose consumer-owned contracts, not adapters.
// Usage: app and HTTP compose the projects feature.
// Related: projects/mod.rs, app/mod.rs.
pub(crate) mod projects;

pub(crate) mod assets;
pub(crate) mod libraries;

pub(crate) mod inference;
pub(crate) mod model_registry;

pub(crate) mod decisions;
pub(crate) mod model_execution;

pub(crate) mod documents;

pub(crate) mod templates;

pub(crate) mod ppt_imports;

pub(crate) mod studio;

pub(crate) mod guides;

pub(crate) mod relations;

pub(crate) mod search;

pub(crate) mod outlines;

pub(crate) mod presentations;
