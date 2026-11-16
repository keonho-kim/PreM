// Purpose: Implement the explicit OpenAI-compatible Chat Completions path.
// Pattern: Shared by vLLM, LiteLLM, generic servers and legacy LM Studio configurations.
// Usage: Never used as an implicit fallback from a native provider.
// Related: transport.rs, mod.rs and native provider adapters.
use super::response::{finish_models, model_id, text, tokens};
use crate::adapters::model_http::bearer as request;
use crate::adapters::model_http::{Transport, read};
use crate::modules::{
    inference::{Completion, CompletionInput, Error},
    model_registry::Credentials,
};
use serde_json::json;
pub(super) async fn models(
    t: &Transport,
    c: &Credentials,
    path: &str,
) -> Result<Vec<String>, Error> {
    let b = read(request(t, c, path, false)?.send().await).await?;
    finish_models(
        b["data"]
            .as_array()
            .ok_or(Error::InvalidResponse)?
            .iter()
            .map(|m| model_id(m["id"].as_str()))
            .collect::<Result<Vec<_>, _>>()?,
    )
}
pub(super) async fn complete(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    let mut b = json!({"model":c.model_identifier,"messages":[{"role":"system","content":i.system},{"role":"user","content":i.prompt}],"stream":false,"temperature":0,"max_tokens":i.max_tokens});
    if let Some(schema) = i.schema {
        b["response_format"] = json!({"type":"json_schema","json_schema":{"name":"response","strict":true,"schema":schema}});
    }
    let r = read(
        request(t, c, "chat/completions", true)?
            .json(&b)
            .send()
            .await,
    )
    .await?;
    if r.pointer("/choices/0/finish_reason")
        .and_then(|v| v.as_str())
        != Some("stop")
    {
        return Err(Error::InvalidResponse);
    }
    Ok(Completion {
        text: text(
            r.pointer("/choices/0/message/content")
                .and_then(|v| v.as_str()),
        )?,
        prompt_tokens: tokens(&r, "/usage/prompt_tokens"),
        completion_tokens: tokens(&r, "/usage/completion_tokens"),
    })
}
