// Purpose: Own model-authored slides and template-slot policy.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: request.rs, response.rs, template.rs.
use super::*;
mod request;
mod response;
pub(super) mod template;
pub(super) use request::input;
pub(super) use response::{validate, validate_spec};
