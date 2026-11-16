// Purpose: Decode shared LLM response fields without mixing them with HTTP mechanics.
// Pattern: Bounded visible text, model IDs and optional usage projections.
// Usage: Provider-specific parsers choose which native fields to pass here.
// Related: transport.rs, openai.rs, claude.rs, gemini.rs.
use crate::modules::inference::Error;
use serde_json::Value;
pub(super) fn text(value: Option<&str>) -> Result<String, Error> {
    let value = value
        .filter(|s| {
            !s.trim().is_empty()
                && s.len() <= 8192
                && !s.contains("<think>")
                && !s.contains("</think>")
        })
        .ok_or(Error::InvalidResponse)?;
    Ok(value.into())
}
pub(super) fn tokens(v: &Value, path: &str) -> Option<i64> {
    v.pointer(path).and_then(Value::as_i64).filter(|n| *n >= 0)
}
pub(super) fn model_id(value: Option<&str>) -> Result<String, Error> {
    value
        .filter(|s| !s.is_empty() && s.len() <= 200 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or(Error::InvalidResponse)
}
pub(super) fn finish_models(mut ids: Vec<String>) -> Result<Vec<String>, Error> {
    if ids.len() > 1000 {
        return Err(Error::InvalidResponse);
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}
