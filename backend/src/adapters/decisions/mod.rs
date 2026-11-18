// Purpose: Implement the Decision-owned evaluator port using explicit native or LLM execution.
// Pattern: Configuration selects a protocol; no generation-client abstraction for native decisions.
// Usage: Application composes one evaluator behind the Decision service.
// Related: native.rs, llm.rs, modules/decisions/mod.rs.
mod llm;
mod native;
mod vllm_sr;
use crate::{
    adapters::model_http::{Transport, read},
    modules::{
        decisions::{Batch, Evaluation, Evaluator},
        inference::ModelClient,
        model_execution::{CallFuture, Error, Outcome},
        model_registry::{Credentials, ProviderKind},
    },
};
use std::sync::Arc;
#[derive(Clone)]
pub(crate) struct DecisionAdapter {
    http: Transport,
    llm: Arc<dyn ModelClient>,
}
impl DecisionAdapter {
    pub fn new(llm: Arc<dyn ModelClient>) -> anyhow::Result<Self> {
        Ok(Self {
            http: Transport::new()?,
            llm,
        })
    }
}
impl Evaluator for DecisionAdapter {
    fn evaluate(&self, c: Credentials, batch: Batch) -> CallFuture<Outcome<Evaluation>> {
        let this = self.clone();
        Box::pin(async move {
            if c.kind.is_system() {
                let c = crate::adapters::model_http::lm_load::resolve(&this.http, c).await?;
                native::evaluate(&this.http, c, batch).await
            } else {
                llm::evaluate(this.llm, c, batch).await
            }
        })
    }
    fn models(&self, c: Credentials) -> CallFuture<Vec<String>> {
        let t = self.http.clone();
        Box::pin(async move {
            if !c.kind.is_system() {
                return Err(Error::Unsupported("System One 연결을 선택하세요."));
            }
            if c.kind == ProviderKind::LmStudioDecision {
                return crate::adapters::model_http::lm_studio_models::list(&t, c, true).await;
            }
            if c.kind == ProviderKind::VllmSrDecision {
                return vllm_sr::models(&t, &c).await;
            }
            let mut ids = Vec::new();
            let mut page: Option<String> = None;
            let mut seen = std::collections::HashSet::new();
            loop {
                let mut request = native::request(&t, &c, "models", false)?;
                if let Some(token) = &page {
                    request = request.query(&[("pageToken", token)]);
                }
                let v = read(request.send().await).await?;
                let key = if c.kind == ProviderKind::GeminiDecision {
                    "models"
                } else {
                    "data"
                };
                for m in v[key].as_array().ok_or(Error::InvalidResponse)? {
                    let id = if key == "models" {
                        m["name"]
                            .as_str()
                            .map(|s| s.strip_prefix("models/").unwrap_or(s))
                    } else {
                        m["id"].as_str()
                    }
                    .ok_or(Error::InvalidResponse)?;
                    if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
                        return Err(Error::InvalidResponse);
                    }
                    ids.push(id.to_owned());
                }
                if ids.len() > 1000 {
                    return Err(Error::InvalidResponse);
                }
                if c.kind != ProviderKind::GeminiDecision {
                    break;
                }
                page = v["nextPageToken"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned);
                let Some(token) = &page else {
                    break;
                };
                if token.len() > 2048 || !seen.insert(token.clone()) || seen.len() > 20 {
                    return Err(Error::InvalidResponse);
                }
            }
            ids.sort();
            ids.dedup();
            Ok(ids)
        })
    }
}
