// Purpose: Implement Anthropic native Messages and paginated model discovery.
// Pattern: Separate system prompt, output_config schema and text-only response projection.
// Usage: Provider kind claude with Bearer authentication and an explicit API version header.
// Related: transport.rs, modules/inference/ports.rs.
use super::response::{finish_models, model_id, text, tokens};
use crate::adapters::model_http::{Transport, read};
use crate::modules::{
    inference::{Completion, CompletionInput, Error},
    model_registry::Credentials,
};
use serde_json::json;
pub(super) async fn models(t: &Transport, c: &Credentials) -> Result<Vec<String>, Error> {
    let mut ids = Vec::new();
    let mut cursor = String::new();
    for _ in 0..10 {
        let mut r = request(t, c, "models", false)?.query(&[("limit", "100")]);
        if !cursor.is_empty() {
            r = r.query(&[("after_id", &cursor)]);
        }
        let body = read(r.send().await).await?;
        for item in body["data"].as_array().ok_or(Error::InvalidResponse)? {
            ids.push(model_id(item["id"].as_str())?);
        }
        if body["has_more"] == false {
            return finish_models(ids);
        }
        let next = body["last_id"]
            .as_str()
            .filter(|v| !v.is_empty() && *v != cursor)
            .ok_or(Error::InvalidResponse)?;
        cursor = next.into();
    }
    Err(Error::InvalidResponse)
}
pub(super) async fn complete(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    let mut body = json!({"model":c.model_identifier,"system":i.system,"messages":[{"role":"user","content":i.prompt}],"max_tokens":i.max_tokens,"stream":false});
    if let Some(schema) = i.schema {
        body["output_config"] = json!({"format":{"type":"json_schema","schema":schema}});
    }
    super::thinking::apply(&mut body, c);
    let reply = read(request(t, c, "messages", true)?.json(&body).send().await).await;
    let r = match reply {
        Err(Error::Upstream(400 | 422))
            if c.thinking.enabled == Some(true)
                && c.thinking.effort.is_none()
                && i.max_tokens > 1024 =>
        {
            body["thinking"] = json!({"type":"enabled","budget_tokens":1024});
            read(request(t, c, "messages", true)?.json(&body).send().await).await?
        }
        other => other?,
    };
    if r["type"] != "message" || r["role"] != "assistant" || r["stop_reason"] != "end_turn" {
        return Err(Error::InvalidResponse);
    }
    let mut content = String::new();
    for part in r["content"].as_array().ok_or(Error::InvalidResponse)? {
        match part["type"].as_str() {
            Some("text") => content.push_str(part["text"].as_str().ok_or(Error::InvalidResponse)?),
            Some("thinking" | "redacted_thinking") => {}
            _ => return Err(Error::InvalidResponse),
        }
    }
    Ok(Completion {
        reasoned: r["content"].as_array().is_some_and(|xs| {
            xs.iter()
                .any(|p| matches!(p["type"].as_str(), Some("thinking" | "redacted_thinking")))
        }),
        text: text(Some(&content))?,
        prompt_tokens: tokens(&r, "/usage/input_tokens"),
        completion_tokens: tokens(&r, "/usage/output_tokens"),
    })
}

fn request(
    t: &Transport,
    c: &Credentials,
    path: &str,
    post: bool,
) -> Result<reqwest::RequestBuilder, Error> {
    Ok(crate::adapters::model_http::bearer(t, c, path, post)?
        .header("anthropic-version", "2026-10-21"))
}
