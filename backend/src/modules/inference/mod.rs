// Purpose: Expose inference execution and diagnostics through a small feature facade.
// Pattern: Common lifecycle, scenario definitions and I/O ports have separate owners.
// Usage: Application composes the facade; HTTP and later processing consumers call it.
// Related: execution.rs, diagnostics.rs, types.rs, ports.rs.
mod context;
pub(crate) use context::bounded_context;
mod diagnostics;
mod execution;
mod ports;
mod types;
pub(crate) use crate::modules::model_execution::{CallFuture, Error, RequestRecord};
pub(crate) use diagnostics::{Diagnostics, TestKind};
pub(crate) use execution::Inference;
pub(crate) use ports::ModelClient;
pub(crate) use types::{Completion, CompletionInput, ExecutionResult};

#[cfg(test)]
mod tests;
