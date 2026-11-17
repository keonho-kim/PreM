// Purpose: Define the explicit connection-diagnostic scenario and its expected answer.
// Pattern: Scenario input and assertions delegate lifecycle and schema validation to execution.
// Usage: Admin calls Diagnostics; it cannot bypass the shared execution policy.
// Related: execution.rs, adapters/http/providers.rs.
use super::{CompletionInput, Error, ExecutionResult, Inference};
use uuid::Uuid;
#[derive(Clone, Copy)]
pub(crate) enum TestKind {
    Text,
    Structured,
}

#[derive(Clone)]
pub(crate) struct Diagnostics(Inference);
impl Diagnostics {
    pub fn new(inference: Inference) -> Self {
        Self(inference)
    }
    pub async fn test(
        &self,
        id: Uuid,
        version: i64,
        kind: TestKind,
    ) -> Result<ExecutionResult, Error> {
        let input=CompletionInput{system:crate::prompts::diagnostics::SYSTEM.into(),prompt:match kind {TestKind::Text=>crate::prompts::diagnostics::TEXT,TestKind::Structured=>crate::prompts::diagnostics::STRUCTURED}.into(),schema:matches!(kind,TestKind::Structured).then(||serde_json::json!({"type":"object","properties":{"status":{"type":"string","enum":["ok"]}},"required":["status"],"additionalProperties":false})),max_tokens:256};
        self.0
            .execute(id, version, input, move |value| {
                if matches!(kind, TestKind::Text) && value.text.trim() != "PreM connection OK" {
                    Err(Error::InvalidResponse)
                } else {
                    Ok(())
                }
            })
            .await
    }
}
