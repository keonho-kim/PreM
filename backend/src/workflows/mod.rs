// Purpose: Expose durable execution contracts without feature or transport dependencies.
// Pattern: Engine owns scheduling; versioned definitions own topology; feature drivers own work.
// Usage: Presentation driver is the first real consumer; other feature workers migrate separately.
// Related: engine/, definitions/, adapters/sqlite/workflows.rs.
pub(crate) mod definitions;
pub(crate) mod engine;
