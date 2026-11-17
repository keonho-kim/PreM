// Purpose: Own multi-slide edit commands, proposals and preview execution.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: commands.rs, execution.rs, request.rs, response.rs.
use super::*;
mod commands;
mod execution;
mod preview;
mod request;
mod response;
mod types;
pub(super) use execution::EditDriver;
use request::input;
use response::validate;
pub(crate) use types::*;
