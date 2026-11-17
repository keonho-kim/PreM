// Purpose: Plan focused follow-up retrieval through the configured LLM or local source terms.
// Pattern: Typed JSON-only query proposals; no shell, SQL or unrestricted tool execution.
// Usage: The durable relation worker requests discovery after source-context review.
// Related: worker.rs, modules/inference/, adapters/sqlite/relations/pull.rs.
use super::*;
use crate::modules::inference::CompletionInput;
use serde_json::json;
use tokio_util::sync::CancellationToken;
impl Relations {
    pub(super) async fn discover(
        &self,
        run: &Run,
        plan: Discovery,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let (queries, request) = if let Some(config) = plan.planner {
            let prompt = serde_json::to_string(&plan.context).map_err(|_| Error::Storage)?;
            if prompt.len() > 20 * 1024 {
                return Err(Error::Invalid);
            }
            let output=self.inference.pinned_json(config,CompletionInput{
                system:crate::prompts::relations::SEARCH.into(),
                prompt,schema:Some(json!({"type":"object","properties":{"queries":{"type":"array","items":{"type":"string"}}},"required":["queries"],"additionalProperties":false})),max_tokens:512,
            },cancel).await.map_err(|e|match e {crate::modules::inference::Error::Cancelled=>Error::Cancelled,other=>Error::Model(other.code())})?;
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Proposal {
                queries: Vec<String>,
            }
            let value: Proposal = serde_json::from_str(&output.text)
                .map_err(|_| Error::Model("invalid_model_response"))?;
            if value.queries.len() > 3
                || value
                    .queries
                    .iter()
                    .any(|q| q.trim().is_empty() || q.chars().count() > 120)
            {
                return Err(Error::Model("invalid_model_response"));
            }
            let mut unique = Vec::new();
            for query in value.queries {
                let query = query.trim().to_owned();
                if !unique.contains(&query) {
                    unique.push(query)
                }
            }
            (unique, Some(output.record.id))
        } else {
            (plan.queries, None)
        };
        self.store.pull(run.clone(), queries, request).await
    }
}
