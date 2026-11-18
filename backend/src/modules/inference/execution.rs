// Purpose: Execute generation requests with generation-specific schema and scenario checks.
// Pattern: Shared execution owns credentials, concurrency, cancellation and history.
// Usage: Diagnostics invokes this boundary; decisions have their own service and port.
// Related: model_execution/, diagnostics.rs, ports.rs.
use super::{Completion, CompletionInput, Error, ExecutionResult, ModelClient, RequestRecord};
use crate::modules::model_execution::{Execution, Outcome};
use std::sync::Arc;
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct Inference {
    execution: Execution,
    client: Arc<dyn ModelClient>,
}
impl Inference {
    pub fn new(execution: Execution, client: Arc<dyn ModelClient>) -> Self {
        Self { execution, client }
    }
    pub fn cancel(&self) {
        self.execution.cancel();
    }
    pub async fn pinned_json(
        &self,
        config: Uuid,
        mut input: CompletionInput,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<ExecutionResult, Error> {
        let schema = input.schema.clone().ok_or(Error::InvalidResponse)?;
        let client = self.client.clone();
        let (text, record) = self
            .execution
            .pinned(config, "structured", cancel, move |c| {
                Box::pin(async move {
                    if c.kind.is_system() {
                        return Err(Error::Unsupported("목차 작성에는 LLM 연결을 선택하세요."));
                    }
                    // The caller explicitly supplies a JSON-only prompt; unsupported native APIs stay native.
                    if !c.kind.descriptor().structured {
                        input.schema = None;
                    }
                    if let Some(budget) = c.max_output_tokens {
                        input.max_tokens = budget;
                    }
                    let result = client.complete(c, input).await?;
                    let value: serde_json::Value =
                        serde_json::from_str(&result.text).map_err(|_| Error::InvalidResponse)?;
                    if !jsonschema::is_valid(&schema, &value) {
                        return Err(Error::InvalidResponse);
                    }
                    Ok(Outcome {
                        value: result.text,
                        input_tokens: result.prompt_tokens,
                        output_tokens: result.completion_tokens,
                    })
                })
            })
            .await?;
        Ok(ExecutionResult { text, record })
    }
    pub async fn probe(
        &self,
        input: crate::modules::model_registry::DiscoveryInput,
        settings: &crate::modules::model_registry::Settings,
        check_effort_validation: bool,
    ) -> Result<bool, Error> {
        self.execution
            .draft_query(input, Some(settings), |mut c| {
                c.probe_effort_validation = check_effort_validation;
                let request = CompletionInput {
                    system: crate::prompts::diagnostics::PROBE.into(),
                    prompt: crate::prompts::diagnostics::TEXT.into(),
                    schema: None,
                    max_tokens: c.max_output_tokens.unwrap_or(2048).min(4096),
                };
                self.client.complete(c, request)
            })
            .await
            .and_then(|response| {
                if response.text.trim() == "PreM connection OK" {
                    Ok(response.reasoned)
                } else {
                    Err(Error::InvalidResponse)
                }
            })
    }
    pub async fn discover(
        &self,
        input: crate::modules::model_registry::DiscoveryInput,
    ) -> Result<Vec<String>, Error> {
        self.execution
            .discover(input, |c| self.client.models(c))
            .await
    }
    pub async fn models(&self, id: Uuid, version: i64) -> Result<Vec<String>, Error> {
        self.execution
            .query(id, version, |c| self.client.models(c))
            .await
    }
    pub async fn history(&self, id: Uuid) -> Result<Vec<RequestRecord>, Error> {
        self.execution.history(id).await
    }
    pub async fn execute(
        &self,
        id: Uuid,
        version: i64,
        mut input: CompletionInput,
        validate: impl FnOnce(&Completion) -> Result<(), Error> + Send + 'static,
    ) -> Result<ExecutionResult, Error> {
        let kind = if input.schema.is_some() {
            "structured"
        } else {
            "text"
        };
        let client = self.client.clone();
        let (text, record) = self
            .execution
            .execute(id, version, kind, move |c| {
                Box::pin(async move {
                    if c.kind.is_system() {
                        return Err(Error::Unsupported(
                            "System One 연결은 판정 API를 사용하세요.",
                        ));
                    }
                    let schema = input.schema.clone();
                    if schema.is_some() && !c.kind.descriptor().structured {
                        return Err(Error::Unsupported(
                            c.kind
                                .descriptor()
                                .structured_reason
                                .unwrap_or("구조화 출력 미지원"),
                        ));
                    }
                    if let Some(tokens) = c.max_output_tokens {
                        input.max_tokens = tokens;
                    }
                    let result = client.complete(c, input).await?;
                    if let Some(schema) = schema {
                        let json: serde_json::Value = serde_json::from_str(&result.text)
                            .map_err(|_| Error::InvalidResponse)?;
                        if !jsonschema::is_valid(&schema, &json) {
                            return Err(Error::InvalidResponse);
                        }
                    }
                    validate(&result)?;
                    Ok(Outcome {
                        value: result.text,
                        input_tokens: result.prompt_tokens,
                        output_tokens: result.completion_tokens,
                    })
                })
            })
            .await?;
        Ok(ExecutionResult { text, record })
    }
}
