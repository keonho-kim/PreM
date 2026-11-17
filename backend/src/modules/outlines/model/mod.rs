// Purpose: Expose outline generation and assignment proposal boundaries.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: request.rs, response.rs, prompts/outlines.rs.
use super::*;
mod request;
mod response;
pub(super) use request::input;
pub(super) use response::validate;
pub(crate) use response::{generated_draft, mapped_assignments};
