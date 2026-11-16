// Purpose: Define the inference feature's model execution and audit persistence boundaries.
// Pattern: Narrow ports with product data, no reqwest or SQLite dependencies.
// Usage: Application wires protocol and storage adapters into Inference.
// Related: mod.rs, adapters/llm/openai_compatible.rs, adapters/sqlite/inference.rs.
use super::{CallFuture, Completion, CompletionInput};
use crate::modules::model_registry::Credentials;
pub(crate) trait ModelClient: Send + Sync {
    fn models(&self, credentials: Credentials) -> CallFuture<Vec<String>>;
    fn complete(&self, credentials: Credentials, input: CompletionInput) -> CallFuture<Completion>;
}
