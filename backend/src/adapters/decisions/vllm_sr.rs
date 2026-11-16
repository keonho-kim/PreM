// Purpose: Discover decision-capable vLLM-SR models without offering routed chat models.
// Pattern: Router inventory first; a missing route permits the native runtime inventory only.
// Usage: Dedicated vllm_sr_decision connections with an explicit /v1 base URL.
// Related: native.rs, model_registry/decision_catalog.rs, tests/vllm_sr.rs.
use crate::{
    adapters::model_http::{Transport, bearer, read},
    modules::{model_execution::Error, model_registry::Credentials},
};
use serde_json::Value;

pub(super) async fn models(t: &Transport, c: &Credentials) -> Result<Vec<String>, Error> {
    let primary = read(bearer(t, c, "systemone/models", false)?.send().await).await;
    let (value, dedicated) = match primary {
        Ok(value) => (value, true),
        // Standalone vllm-srun serves /models; never probe after auth, overload or JSON errors.
        Err(Error::Upstream(404 | 405)) => (
            read(bearer(t, c, "models", false)?.send().await).await?,
            false,
        ),
        Err(error) => return Err(error),
    };
    parse_models(&value, dedicated)
}

fn parse_models(value: &Value, dedicated: bool) -> Result<Vec<String>, Error> {
    // The standard `models` list contains decision models; mixed OpenAI `data` needs evidence.
    let standard = value.get("models").is_some();
    let entries = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)
        .filter(|entries| entries.len() <= 1000)
        .ok_or(Error::InvalidResponse)?;
    let mut ids = Vec::new();
    for entry in entries {
        let id = entry
            .get("id")
            .or_else(|| entry.get("name"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control))
            .ok_or(Error::InvalidResponse)?;
        if entry["system"] == "two" || entry["routing"] == true {
            continue;
        }
        let capabilities = entry
            .get("question_types")
            .or_else(|| entry.pointer("/card/question_types"))
            .or_else(|| entry.get("features"));
        let supports_choice = match capabilities {
            Some(types) => types
                .as_array()
                .filter(|types| types.iter().all(Value::is_string))
                .ok_or(Error::InvalidResponse)?
                .iter()
                .any(|kind| kind == "choice"),
            None => dedicated || standard,
        };
        if supports_choice {
            ids.push(id.to_owned());
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}
