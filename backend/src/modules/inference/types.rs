// Purpose: Define generation inputs and visible text output.
// Pattern: Execution records and errors have one shared owner.
// Usage: LLM protocols and diagnostic scenarios.
// Related: model_execution/, execution.rs.
use super::RequestRecord;
pub(crate) struct CompletionInput {
    pub system: String,
    pub prompt: String,
    pub schema: Option<serde_json::Value>,
    pub max_tokens: u32,
}
pub(crate) struct Completion {
    pub text: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
}
pub(crate) struct ExecutionResult {
    pub record: RequestRecord,
    pub text: String,
}
