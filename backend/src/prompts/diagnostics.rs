// Purpose: Define diagnostics task instructions.
// Pattern: Task-owned static instructions; inputs and validation remain with feature modules.
// Usage: Compiled constants consumed by the named model task.
// Related: modules/inference/diagnostics.rs.
pub(crate) const SYSTEM: &str =
    "This is a connectivity diagnostic. Answer directly without reasoning.";
pub(crate) const TEXT: &str = "Reply with only: PreM connection OK";
pub(crate) const STRUCTURED: &str = r#"Return exactly the JSON object {"status":"ok"}."#;
