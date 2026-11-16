// Purpose: Group concrete transport and persistence implementations.
// Pattern: Private adapters composed by the application root.
// Usage: app imports the adapters required by an implemented feature.
// Related: app/mod.rs, modules/projects/ports.rs.
pub(crate) mod filesystem;
pub(crate) mod http;
pub(crate) mod sqlite;

pub(crate) mod formats;

pub(crate) mod llm;

pub(crate) mod decisions;
mod model_http;

mod markdown;
pub(crate) mod processes;
