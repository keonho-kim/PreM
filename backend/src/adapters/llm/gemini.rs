// Purpose: Implement Gemini native generateContent and model discovery.
// Pattern: Header authentication, URL-safe model segments and visible text parts only.
// Usage: Provider kind gemini with a v1beta base URL; no OpenAI compatibility bridge.
// Related: transport.rs, Google Generative Language API.
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
        let mut req = request(t, c, "models", false)?.query(&[("pageSize", "100")]);
        if !cursor.is_empty() {
            req = req.query(&[("pageToken", &cursor)]);
        }
        let b = read(req.send().await).await?;
        for item in b["models"].as_array().ok_or(Error::InvalidResponse)? {
            if item["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|a| a.iter().any(|m| m == "generateContent"))
            {
                ids.push(model_id(
                    item["name"]
                        .as_str()
                        .and_then(|s| s.strip_prefix("models/")),
                )?);
            }
        }
        match b["nextPageToken"].as_str().filter(|s| !s.is_empty()) {
            None => return finish_models(ids),
            Some(next) if next != cursor && next.len() < 4096 => cursor = next.into(),
            _ => return Err(Error::InvalidResponse),
        }
    }
    Err(Error::InvalidResponse)
}
pub(super) async fn complete(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    let model = c
        .model_identifier
        .strip_prefix("models/")
        .unwrap_or(&c.model_identifier);
    if model.is_empty()
        || !model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        || model == "."
        || model == ".."
    {
        return Err(Error::InvalidResponse);
    }
    let mut body = json!({"systemInstruction":{"parts":[{"text":i.system}]},"contents":[{"role":"user","parts":[{"text":i.prompt}]}],"generationConfig":{"maxOutputTokens":i.max_tokens,"candidateCount":1}});
    if let Some(schema) = i.schema {
        body["generationConfig"]["responseMimeType"] = json!("application/json");
        body["generationConfig"]["responseJsonSchema"] = schema;
    }
    let r = read(
        request(t, c, &format!("models/{model}:generateContent"), true)?
            .json(&body)
            .send()
            .await,
    )
    .await?;
    let candidate = r["candidates"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or(Error::InvalidResponse)?;
    if candidate["finishReason"] != "STOP" || r.pointer("/promptFeedback/blockReason").is_some() {
        return Err(Error::InvalidResponse);
    }
    let mut content = String::new();
    for part in candidate["content"]["parts"]
        .as_array()
        .ok_or(Error::InvalidResponse)?
    {
        if part["thought"] == true {
            continue;
        }
        content.push_str(part["text"].as_str().ok_or(Error::InvalidResponse)?);
    }
    Ok(Completion {
        text: text(Some(&content))?,
        prompt_tokens: tokens(&r, "/usageMetadata/promptTokenCount"),
        completion_tokens: tokens(&r, "/usageMetadata/candidatesTokenCount"),
    })
}

fn request(
    t: &Transport,
    c: &Credentials,
    path: &str,
    post: bool,
) -> Result<reqwest::RequestBuilder, Error> {
    use secrecy::ExposeSecret;
    let request = t.request(&c.base_url, c.timeout_seconds, path, post);
    if let Some(token) = &c.token {
        let mut value = reqwest::header::HeaderValue::from_str(token.expose_secret())
            .map_err(|_| Error::Authentication)?;
        value.set_sensitive(true);
        Ok(request.header("x-goog-api-key", value))
    } else {
        Ok(request)
    }
}
