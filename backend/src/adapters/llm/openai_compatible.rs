// Purpose: Implement the explicit OpenAI-compatible Chat Completions path.
// Pattern: Shared by vLLM, LiteLLM, generic servers and legacy LM Studio configurations.
// Usage: Never used as an implicit fallback from a native provider.
// Related: transport.rs, mod.rs and native provider adapters.
use super::response::{finish_models, model_id, tokens, visible_completion};
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
    if c.thinking.enabled == Some(true) {
        b.as_object_mut()
            .expect("chat request")
            .remove("temperature");
        if matches!(
            c.kind,
            crate::modules::model_registry::ProviderKind::OpenaiCompatible
                | crate::modules::model_registry::ProviderKind::Litellm
        ) {
            b.as_object_mut()
                .expect("chat request")
                .remove("max_tokens");
            b["max_completion_tokens"] = json!(i.max_tokens);
        }
    }
    super::thinking::apply(&mut b, c);
    let send = |body: serde_json::Value| async move {
        read(
            request(t, c, "chat/completions", true)?
                .json(&body)
                .send()
                .await,
        )
        .await
    };
    // LiteLLM deployments backed by older Claude models can expose budget-based thinking alone.
    let r = if c.kind == crate::modules::model_registry::ProviderKind::Litellm
        && c.thinking.enabled == Some(true)
        && c.thinking.effort.is_none()
        && i.max_tokens > 1024
    {
        match send(b.clone()).await {
            Err(Error::Upstream(400 | 422)) => {
                let fields = b.as_object_mut().expect("chat request");
                fields.remove("reasoning_effort");
                fields.remove("max_completion_tokens");
                b["max_tokens"] = json!(i.max_tokens);
                b["thinking"] = json!({"type":"enabled","budget_tokens":1024});
                send(b).await?
            }
            other => other?,
        }
    } else {
        send(b).await?
    };
    if r.pointer("/choices/0/finish_reason")
        .and_then(|v| v.as_str())
        != Some("stop")
    {
        return Err(Error::InvalidResponse);
    }
    let (text, inline_reasoning) = visible_completion(
        r.pointer("/choices/0/message/content")
            .and_then(|v| v.as_str()),
        false,
    )?;
    Ok(Completion {
        reasoned: inline_reasoning
            || r.pointer("/usage/completion_tokens_details/reasoning_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                > 0
            || [
                "/choices/0/message/reasoning_content",
                "/choices/0/message/reasoning",
            ]
            .into_iter()
            .any(|k| {
                r.pointer(k)
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
            }),
        text,
        prompt_tokens: tokens(&r, "/usage/prompt_tokens"),
        completion_tokens: tokens(&r, "/usage/completion_tokens"),
    })
}
