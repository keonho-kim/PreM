// Purpose: Implement LM Studio's native REST model list and stateless chat endpoint.
// Pattern: Native output items are projected to user-visible messages only.
// Usage: lm_studio_native with /api/v1/ base; compatibility remains an explicit other kind.
// Related: transport.rs, https://lmstudio.ai/docs/developer/rest/chat.
use super::response::{text, tokens};
use crate::adapters::model_http::bearer as request;
use crate::adapters::model_http::{Transport, read};
use crate::modules::{
    inference::{Completion, CompletionInput, Error},
    model_registry::Credentials,
};
use serde_json::json;
pub(super) async fn complete(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    let mut body = json!({"model":c.model_identifier,"system_prompt":i.system,"input":i.prompt,"max_output_tokens":i.max_tokens,"stream":false,"store":false,"integrations":[]});
    super::thinking::apply(&mut body, c);
    let r = read(request(t, c, "chat", true)?.json(&body).send().await).await?;
    let mut content = String::new();
    for part in r["output"].as_array().ok_or(Error::InvalidResponse)? {
        match part["type"].as_str() {
            Some("message") => {
                content.push_str(part["content"].as_str().ok_or(Error::InvalidResponse)?)
            }
            Some("reasoning") => {}
            _ => return Err(Error::InvalidResponse),
        }
    }
    Ok(Completion {
        reasoned: r["output"].as_array().is_some_and(|xs| {
            xs.iter().any(|p| {
                p["type"] == "reasoning"
                    && p["content"].as_str().is_some_and(|s| !s.trim().is_empty())
            })
        }),
        text: text(Some(&content))?,
        prompt_tokens: tokens(&r, "/stats/input_tokens"),
        completion_tokens: tokens(&r, "/stats/total_output_tokens"),
    })
}
