// Purpose: Use llama.cpp completion and SGLang generate without an OpenAI bridge.
// Pattern: Server-side llama chat templating; server-side tokenization for SGLang.
// Usage: Root server URLs for llama_cpp and sglang kinds.
// Related: transport.rs, model discovery contracts and native provider tests.
use super::response::{model_id, text, tokens};
use crate::adapters::model_http::bearer as request;
use crate::adapters::model_http::{Transport, read};
use crate::modules::{
    inference::{Completion, CompletionInput, Error},
    model_registry::Credentials,
};
use serde_json::json;
pub(super) async fn sglang_models(t: &Transport, c: &Credentials) -> Result<Vec<String>, Error> {
    let b = read(request(t, c, "get_model_info", false)?.send().await).await?;
    if b["is_generation"] != true {
        return Err(Error::InvalidResponse);
    }
    Ok(vec![model_id(b["model_path"].as_str())?])
}
pub(super) async fn sglang(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    // The native endpoint serves one loaded model; never silently ignore the configured ID.
    if !sglang_models(t, c).await?.contains(&c.model_identifier) {
        return Err(Error::Unsupported(
            "SGLang에 로드된 model_path와 설정된 모델 ID가 다릅니다.",
        ));
    }
    let template = json!({"model":c.model_identifier,"messages":[{"role":"system","content":i.system},{"role":"user","content":i.prompt}]});
    let rendered = read(
        request(t, c, "tokenize", true)?
            .json(&template)
            .send()
            .await,
    )
    .await?;
    let ids = rendered["tokens"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 32768 && a.iter().all(|v| v.as_u64().is_some()))
        .ok_or(Error::InvalidResponse)?;
    let mut body = json!({"input_ids":ids,"sampling_params":{"max_new_tokens":i.max_tokens,"temperature":0},"stream":false});
    if let Some(schema) = i.schema {
        body["sampling_params"]["json_schema"] = json!(schema.to_string());
    }
    let r = read(request(t, c, "generate", true)?.json(&body).send().await).await?;
    if r.pointer("/meta_info/finish_reason/type")
        .and_then(|v| v.as_str())
        != Some("stop")
    {
        return Err(Error::InvalidResponse);
    }
    Ok(Completion {
        text: text(r["text"].as_str())?,
        prompt_tokens: tokens(&r, "/meta_info/prompt_tokens"),
        completion_tokens: tokens(&r, "/meta_info/completion_tokens"),
    })
}
pub(super) async fn llama(
    t: &Transport,
    c: &Credentials,
    i: CompletionInput,
) -> Result<Completion, Error> {
    let template = json!({"model":c.model_identifier,"messages":[{"role":"system","content":i.system},{"role":"user","content":i.prompt}]});
    let rendered = read(
        request(t, c, "apply-template", true)?
            .json(&template)
            .send()
            .await,
    )
    .await?;
    let prompt = rendered["prompt"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or(Error::InvalidResponse)?;
    let mut body = json!({"model":c.model_identifier,"prompt":prompt,"n_predict":i.max_tokens,"temperature":0,"stream":false,"cache_prompt":false});
    if let Some(schema) = i.schema {
        body["json_schema"] = schema;
    }
    let r = read(request(t, c, "completion", true)?.json(&body).send().await).await?;
    if !matches!(r["stop_type"].as_str(), Some("eos" | "word")) || r["truncated"] == true {
        return Err(Error::InvalidResponse);
    }
    Ok(Completion {
        text: text(r["content"].as_str())?,
        prompt_tokens: tokens(&r, "/tokens_evaluated"),
        completion_tokens: tokens(&r, "/tokens_predicted"),
    })
}
