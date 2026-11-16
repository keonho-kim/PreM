// Purpose: Translate product inference into OpenAI's native Responses API.
// Pattern: Explicit output_text extraction, no storage or hidden reasoning exposure.
// Usage: Provider kind openai; model identifiers are selected by the administrator.
// Related: transport.rs, https://developers.openai.com/api/docs/guides/migrate-to-responses.
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
    let mut body = json!({"model":c.model_identifier,"instructions":i.system,"input":i.prompt,"max_output_tokens":i.max_tokens,"stream":false,"store":false});
    if let Some(schema) = i.schema {
        body["text"] = json!({"format":{"type":"json_schema","name":"response","strict":true,"schema":schema}});
    }
    let r = read(request(t, c, "responses", true)?.json(&body).send().await).await?;
    if r["status"] != "completed" || r.get("error").is_some_and(|e| !e.is_null()) {
        return Err(Error::InvalidResponse);
    }
    let items = r["output"].as_array().ok_or(Error::InvalidResponse)?;
    let mut content = String::new();
    for item in items {
        match item["type"].as_str() {
            Some("reasoning") => continue,
            Some("message") if item["role"] == "assistant" && item["status"] == "completed" => {
                for part in item["content"].as_array().ok_or(Error::InvalidResponse)? {
                    if part["type"] != "output_text" {
                        return Err(Error::InvalidResponse);
                    }
                    content.push_str(part["text"].as_str().ok_or(Error::InvalidResponse)?);
                }
            }
            _ => return Err(Error::InvalidResponse),
        }
    }
    Ok(Completion {
        text: text(Some(&content))?,
        prompt_tokens: tokens(&r, "/usage/input_tokens"),
        completion_tokens: tokens(&r, "/usage/output_tokens"),
    })
}
