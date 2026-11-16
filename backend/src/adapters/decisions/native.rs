// Purpose: Translate native System One, OpenAI Decisions and Gemini Decisions choice contracts.
// Pattern: Explicit wire mappings preserve reported probabilities and reject refusals/missing answers.
// Usage: System connections only; text-only choice subset, no protocol fallback.
// Related: mod.rs, modules/decisions/, official API links in dev-docs/08-dependencies.md.
use crate::{
    adapters::model_http::{Transport, bearer, read},
    modules::{
        decisions::{Answer, Batch, Evaluation},
        model_execution::{Error, Outcome},
        model_registry::{Credentials, ProviderKind as K},
    },
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
pub(super) fn request(
    t: &Transport,
    c: &Credentials,
    path: &str,
    post: bool,
) -> Result<reqwest::RequestBuilder, Error> {
    if c.kind != K::GeminiDecision {
        return bearer(t, c, path, post);
    }
    use secrecy::ExposeSecret;
    let token = c.token.as_ref().ok_or(Error::Authentication)?;
    let mut value = reqwest::header::HeaderValue::from_str(token.expose_secret())
        .map_err(|_| Error::Authentication)?;
    value.set_sensitive(true);
    Ok(t.request(&c.base_url, c.timeout_seconds, path, post)
        .header("x-goog-api-key", value))
}
pub(super) async fn evaluate(
    t: &Transport,
    c: Credentials,
    batch: Batch,
) -> Result<Outcome<Evaluation>, Error> {
    let (path, body) = match c.kind {
        K::OpenaiDecision => {
            let questions = batch.questions.iter().map(|(name,q)| json!({"name":name,"type":"choice","instructions":q.instructions(),"choices":q.criteria().iter().map(|(value,description)|json!({"value":value,"description":description})).collect::<Vec<_>>()})).collect::<Vec<_>>();
            (
                "decisions",
                json!({"model":c.model_identifier,"input":state_text(&batch.state),"questions":questions}),
            )
        }
        K::GeminiDecision => (
            "decisions",
            json!({"model":c.model_identifier,"input":state_text(&batch.state),"questions":batch.questions}),
        ),
        K::VllmSrDecision => (
            "systemone",
            json!({"model":c.model_identifier,"state":state_text(&batch.state),"questions":batch.questions}),
        ),
        _ => (
            "systemone",
            json!({"model":c.model_identifier,"state":batch.state,"questions":batch.questions}),
        ),
    };
    let v = read(request(t, &c, path, true)?.json(&body).send().await).await?;
    let mut answers = BTreeMap::new();
    if c.kind == K::OpenaiDecision {
        for a in v["answers"].as_array().ok_or(Error::InvalidResponse)? {
            let id = a["name"].as_str().ok_or(Error::InvalidResponse)?;
            let mut probabilities = BTreeMap::new();
            for p in a["probabilities"]
                .as_array()
                .ok_or(Error::InvalidResponse)?
            {
                let k = p["value"].as_str().ok_or(Error::InvalidResponse)?;
                let value = p["probability"].as_f64().ok_or(Error::InvalidResponse)?;
                if probabilities.insert(k.into(), value).is_some() {
                    return Err(Error::InvalidResponse);
                }
            }
            if answers
                .insert(id.into(), answer(a, probabilities)?)
                .is_some()
            {
                return Err(Error::InvalidResponse);
            }
        }
    } else {
        for (id, a) in v["answers"].as_object().ok_or(Error::InvalidResponse)? {
            let p = serde_json::from_value(a["probabilities"].clone())
                .map_err(|_| Error::InvalidResponse)?;
            answers.insert(id.clone(), answer(a, p)?);
        }
    }
    let model = match v.get("model") {
        Some(value) => value.as_str().ok_or(Error::InvalidResponse)?.to_owned(),
        None => c.model_identifier,
    };
    let (input, output) = if c.kind == K::GeminiDecision {
        ("/usage/total_input_tokens", "/usage/total_output_tokens")
    } else {
        ("/usage/input_tokens", "/usage/output_tokens")
    };
    Ok(Outcome {
        value: Evaluation {
            answers,
            model,
            statistics: "provider_reported",
        },
        input_tokens: tokens(&v, input)?,
        output_tokens: tokens(&v, output)?,
    })
}
fn answer(a: &Value, p: BTreeMap<String, f64>) -> Result<Answer, Error> {
    if a["type"] != "choice" {
        return Err(Error::InvalidResponse);
    }
    Ok(Answer {
        choice: a["choice"].as_str().ok_or(Error::InvalidResponse)?.into(),
        probabilities: Some(p),
        confidence: Some(a["confidence"].as_f64().ok_or(Error::InvalidResponse)?),
    })
}
fn state_text(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
fn tokens(v: &Value, path: &str) -> Result<Option<i64>, Error> {
    v.pointer(path)
        .map(|n| n.as_i64().filter(|v| *v >= 0).ok_or(Error::InvalidResponse))
        .transpose()
}
