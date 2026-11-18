// Purpose: Apply saved LM Studio token settings to an explicitly prepared local instance.
// Pattern: Check live inventory, reuse matching instances and load only on an Admin command.
// Usage: Generation and decision adapters resolve the pinned configuration before inference.
// Related: lm_studio_models.rs, http/model_load.rs, V1__baseline.sql.
use super::{Transport, bearer, lm_studio_models::native_url, read};
use crate::modules::{model_execution::Error, model_registry::Credentials};
use serde_json::{Value, json};

fn matches(config: &Value, c: &Credentials) -> bool {
    [
        ("context_length", c.context_length),
        ("physical_batch_size", c.physical_batch_size),
    ]
    .into_iter()
    .all(|(key, n)| n.is_none_or(|n| config[key].as_u64() == Some(u64::from(n))))
}
async fn identify(t: &Transport, c: &Credentials) -> Result<(String, Option<String>), Error> {
    let inventory = read(bearer(t, c, "models", false)?.send().await).await?;
    let category = if c.kind.is_system() {
        "decision"
    } else {
        "llm"
    };
    let model = inventory["models"]
        .as_array()
        .ok_or(Error::InvalidResponse)?
        .iter()
        .find(|m| {
            m["type"] == category
                && (m["key"] == c.model_identifier
                    || m["loaded_instances"]
                        .as_array()
                        .is_some_and(|xs| xs.iter().any(|x| x["id"] == c.model_identifier)))
        })
        .ok_or(Error::Unsupported(
            "LM Studio에서 모델을 찾지 못했습니다. 모델 목록에서 다시 선택하세요.",
        ))?;
    if let Some(max) = model["max_context_length"].as_u64()
        && [c.context_length, c.physical_batch_size]
            .into_iter()
            .flatten()
            .any(|n| u64::from(n) > max)
    {
        return Err(Error::Unsupported(
            "이 모델이 지원하는 컨텍스트 길이를 초과했습니다. 토큰 설정을 줄여주세요.",
        ));
    }
    let key = model["key"]
        .as_str()
        .ok_or(Error::InvalidResponse)?
        .to_owned();
    let id = model["loaded_instances"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| matches(&i["config"], c))
        .find_map(|i| valid_id(&i["id"]))
        .map(str::to_owned);
    Ok((key, id))
}
fn valid_id(v: &Value) -> Option<&str> {
    v.as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 200 && !s.chars().any(char::is_control))
}
pub(crate) async fn resolve(t: &Transport, mut c: Credentials) -> Result<Credentials, Error> {
    if c.context_length.is_none() && c.physical_batch_size.is_none() {
        return Ok(c);
    }
    let url = native_url(&c)?;
    let original = std::mem::replace(&mut c.base_url, url);
    c.model_identifier = identify(t, &c).await?.1.ok_or(Error::Unsupported(
        "저장된 토큰 설정에 맞는 인스턴스가 없습니다. Admin 연결 설정에서 모델을 준비하세요.",
    ))?;
    c.base_url = original;
    Ok(c)
}
pub(crate) async fn prepare(t: &Transport, mut c: Credentials) -> Result<String, Error> {
    if !c.kind.is_lm_studio() || (c.context_length.is_none() && c.physical_batch_size.is_none()) {
        return Err(Error::Unsupported("LM Studio 토큰 설정을 먼저 저장하세요."));
    }
    c.base_url = native_url(&c)?;
    let (key, existing) = identify(t, &c).await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let mut payload = json!({"model":key,"echo_load_config":true});
    if let Some(n) = c.context_length {
        payload["context_length"] = json!(n);
    }
    if let Some(n) = c.physical_batch_size {
        payload["physical_batch_size"] = json!(n);
        payload["eval_batch_size"] = json!(n);
    }
    let r = read(
        bearer(t, &c, "models/load", true)?
            .json(&payload)
            .send()
            .await,
    )
    .await?;
    if r["status"] != "loaded" || !matches(&r["load_config"], &c) {
        return Err(Error::Unsupported(
            "LM Studio가 요청한 토큰 설정을 적용하지 못했습니다. 모델 서버의 로딩 상태를 확인하세요.",
        ));
    }
    valid_id(&r["instance_id"])
        .map(str::to_owned)
        .ok_or(Error::InvalidResponse)
}
