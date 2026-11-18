// Purpose: Probe unsaved Admin connection settings and authorize the exact tested revision.
// Pattern: A short-lived opaque receipt binds the destination, credentials, role and all draft fields.
// Usage: POST diagnose, then PUT the same JSON with X-Connection-Diagnostic.
// Related: providers.rs, model_registry/discovery.rs, sqlite/providers.rs.
use super::providers::{ApiError, ProviderApi, ProviderDto, body, json};
use crate::modules::{
    inference,
    model_registry::{DiscoveryInput, Effort, Error, Settings, Thinking},
};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    expected_version: i64,
    #[serde(default)]
    decision: bool,
    name: String,
    provider_type: String,
    base_url: String,
    model_identifier: String,
    timeout_seconds: u32,
    max_output_tokens: Option<u32>,
    context_length: Option<u32>,
    physical_batch_size: Option<u32>,
    thinking: Option<bool>,
    thinking_effort: Option<Effort>,
    enabled: bool,
    api_key: Option<String>,
    #[serde(default)]
    clear_secret: bool,
}

impl Draft {
    fn settings(&self) -> Result<Settings, Error> {
        Settings {
            name: self.name.clone(),
            provider_type: self.provider_type.parse()?,
            base_url: self.base_url.clone(),
            model_identifier: self.model_identifier.clone(),
            timeout_seconds: self.timeout_seconds,
            max_output_tokens: self.max_output_tokens,
            context_length: self.context_length,
            physical_batch_size: self.physical_batch_size,
            enabled: self.enabled,
            thinking: Thinking {
                enabled: self.thinking,
                effort: self.thinking_effort,
            },
        }
        .validate()
    }
    fn discovery(&self, id: Uuid, s: &Settings) -> DiscoveryInput {
        DiscoveryInput {
            connection_id: (self.expected_version > 0).then_some(id),
            expected_version: (self.expected_version > 0).then_some(self.expected_version),
            kind: s.provider_type,
            base_url: Some(s.base_url.clone()),
            api_key: self.api_key.clone(),
            clear_secret: self.clear_secret,
        }
    }
}
fn parse(input: Result<Json<Value>, JsonRejection>) -> Result<(Draft, String), ApiError> {
    let value = body(input)?;
    let hash = hex::encode(Sha256::digest(value.to_string().as_bytes()));
    let draft: Draft = serde_json::from_value(value)
        .map_err(|_| Error::Invalid("모델 설정 입력을 확인하세요."))?;
    if draft.expected_version < 0 {
        return Err(Error::Invalid("기준 버전을 확인하세요.").into());
    }
    Ok((draft, hash))
}

pub(super) async fn diagnose(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    input: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ApiError> {
    let (draft, hash) = parse(input)?;
    let mut s = draft.settings()?;
    let mut accepted = Vec::new();
    let mut effort_unverified = false;
    let mut thinking_observed = false;
    let mut selected = s.thinking.effort;
    if s.provider_type.is_lm_studio()
        && (s.context_length.is_some() || s.physical_batch_size.is_some())
    {
        let loader = api.model_loader.clone();
        api.execution
            .draft_query(draft.discovery(id, &s), Some(&s), move |c| {
                Box::pin(async move { loader.prepare_draft(c).await })
            })
            .await?;
    }
    let advertised = if s.provider_type.is_lm_studio()
        && !s.provider_type.is_system()
        && s.thinking.enabled.is_some()
        && !draft.decision
    {
        let loader = api.model_loader.clone();
        api.execution
            .draft_query(draft.discovery(id, &s), Some(&s), move |c| {
                Box::pin(async move { loader.reasoning_options(c).await })
            })
            .await?
    } else {
        None
    };
    if s.provider_type.is_system() || draft.decision {
        s.thinking = Thinking::OFF;
        api.decisions.probe(draft.discovery(id, &s), &s).await?;
        selected = None;
    } else if s.thinking.enabled == Some(true) {
        s.thinking.effort = None;
        let baseline = probe_option(&api, &draft, id, &s, false).await?;
        thinking_observed = baseline == Some(true);
        let base = baseline.is_some()
            && advertised
                .as_ref()
                .is_none_or(|values| values.iter().any(|v| v == "on"));
        for effort in Effort::ALL {
            s.thinking.effort = Some(effort);
            let trial = probe_option(&api, &draft, id, &s, false).await?;
            if trial.is_some()
                && advertised
                    .as_ref()
                    .is_none_or(|values| values.iter().any(|v| v == effort.as_str()))
            {
                thinking_observed |= trial == Some(true);
                accepted.push(effort);
            }
        }
        if advertised.is_none()
            && !accepted.is_empty()
            && probe_option(&api, &draft, id, &s, true).await?.is_some()
        {
            // A permissive gateway may accept every unknown extension without applying it.
            effort_unverified = true;
            accepted.clear();
        }
        selected = selected.filter(|v| accepted.contains(v));
        if selected.is_none() && draft.thinking_effort.is_none() && !base {
            // Level-only models cannot encode "on" without a level. Prefer a tested moderate level.
            selected = [Effort::Medium, Effort::Low, Effort::High, Effort::Xhigh]
                .into_iter()
                .find(|e| accepted.contains(e));
        }
        if !base && selected.is_none() {
            let message = if accepted.is_empty() {
                "Thinking을 지원하는 요청을 확인하지 못했습니다. 모델 기본값으로 다시 진단하세요."
            } else {
                "선택한 effort가 거부됐습니다. 수락된 값을 선택하거나 effort를 비워 다시 진단하세요."
            };
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"ticket":null,"message":message,"advertised":advertised,"accepted_efforts":accepted,"effective_effort":null,"thinking_observed":thinking_observed,"effort_unverified":effort_unverified}),
            ));
        }
    } else {
        api.inference
            .probe(draft.discovery(id, &s), &s, false)
            .await?;
    }
    if !draft.decision
        && s.thinking.enabled == Some(false)
        && advertised
            .as_ref()
            .is_some_and(|values| !values.iter().any(|v| v == "off"))
    {
        return Err(inference::Error::Unsupported("모델 인벤토리에 Thinking 끄기가 지원 값으로 등록되어 있지 않습니다. 모델 기본값을 선택하세요.").into());
    }
    let ticket = api.registry.certify(id, hash, selected).await?;
    Ok(json(
        StatusCode::OK,
        serde_json::json!({"thinking_observed":thinking_observed,"effort_unverified":effort_unverified,"advertised":advertised,"ticket":ticket,"accepted_efforts":accepted,"effective_effort":selected}),
    ))
}
async fn probe_option(
    api: &ProviderApi,
    draft: &Draft,
    id: Uuid,
    s: &Settings,
    control: bool,
) -> Result<Option<bool>, ApiError> {
    match api
        .inference
        .probe(draft.discovery(id, s), s, control)
        .await
    {
        Ok(reasoned) => Ok(Some(reasoned)),
        Err(inference::Error::Upstream(400 | 422)) => Ok(None),
        Err(err) => Err(err.into()),
    }
}
pub(super) async fn save(
    State(api): State<ProviderApi>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    input: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ApiError> {
    let (draft, hash) = parse(input)?;
    let mut s = draft.settings()?;
    let token = headers
        .get("X-Connection-Diagnostic")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or(Error::Invalid(
            "저장 전에 현재 설정으로 연결 진단을 실행하세요.",
        ))?;
    if draft.expected_version > 0 && api.registry.get(id).await?.version != draft.expected_version {
        return Err(Error::Conflict.into());
    }
    let effective = api.registry.certified_effort(id, token, hash).await?;
    if draft.decision || s.provider_type.is_system() {
        // Editing a shared writing connection in Decision must not turn off thinking for writing.
        s.thinking = Thinking::default();
        if !s.provider_type.is_system() && draft.expected_version > 0 {
            let old = api.registry.get(id).await?;
            if old.settings.provider_type == s.provider_type
                && old.settings.base_url == s.base_url
                && old.settings.model_identifier == s.model_identifier
            {
                s.thinking = old.settings.thinking;
            }
        }
    } else {
        s.thinking.effort = effective;
    }
    let saved = api
        .registry
        .save(
            id,
            draft.expected_version,
            s,
            draft.api_key,
            draft.clear_secret,
        )
        .await?;
    Ok(json(StatusCode::OK, ProviderDto::from(saved)))
}
