// Purpose: Read native LM Studio inventory for generation and Decision connections.
// Pattern: Preserve gateway prefixes, filter explicit model types and list stable model keys alongside loaded IDs.
// Usage: Both LM Studio protocols discover through /api/v1/models without loading any model.
// Related: adapters/llm/lm_studio.rs, adapters/decisions/mod.rs, native model-list API.
use super::{Transport, bearer, read};
use crate::modules::{model_execution::Error, model_registry::Credentials};
pub(crate) async fn list(
    t: &Transport,
    mut c: Credentials,
    decision: bool,
) -> Result<Vec<String>, Error> {
    c.base_url = native_url(&c)?;
    let body = read(bearer(t, &c, "models", false)?.send().await).await?;
    let mut ids = Vec::new();
    let category = if decision { "decision" } else { "llm" };
    for model in body["models"].as_array().ok_or(Error::InvalidResponse)? {
        if model["type"] != category {
            continue;
        }
        let instances = model["loaded_instances"].as_array();
        let values: Vec<_> = match instances.filter(|a| !a.is_empty()) {
            Some(items) => model["key"]
                .as_str()
                .map(Some)
                .into_iter()
                .chain(
                    items
                        .iter()
                        .filter(|i| i["id"] != model["key"])
                        .map(|i| i["id"].as_str()),
                )
                .collect(),
            None => vec![model["key"].as_str()],
        };
        for value in values {
            let id = value
                .filter(|s| !s.is_empty() && s.len() <= 200 && !s.chars().any(char::is_control))
                .ok_or(Error::InvalidResponse)?;
            ids.push(id.to_owned());
            if ids.len() > 1000 {
                return Err(Error::InvalidResponse);
            }
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

pub(crate) fn native_url(c: &Credentials) -> Result<String, Error> {
    if c.kind != crate::modules::model_registry::ProviderKind::LmStudioNative
        && !c.base_url.ends_with("/api/v1/")
    {
        let prefix = c.base_url.strip_suffix("/v1/").ok_or(Error::Unsupported(
            "LM Studio 주소는 /api/v1 또는 /v1로 끝나야 합니다.",
        ))?;
        return Ok(format!("{prefix}/api/v1/"));
    }
    Ok(c.base_url.clone())
}
