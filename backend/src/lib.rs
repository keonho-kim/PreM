// Purpose: Expose the application composition boundary to the binary and integration tests.
// Pattern: Private feature and adapter implementations behind one application facade.
// Usage: Application::open for an owned persistent instance, then router and shutdown.
// Related: app/mod.rs, adapters/, modules/projects/.
mod adapters;
pub mod app;
mod modules;
