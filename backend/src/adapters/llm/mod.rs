// Purpose: Dispatch pinned provider configurations to their explicit wire protocols.
// Pattern: One bounded HTTP transport, provider-owned serialization and parsing.
// Usage: Application wires ProviderClient into the inference feature.
// Related: openai.rs, claude.rs, gemini.rs, lm_studio.rs, local_native.rs.
mod claude;
mod gemini;
mod lm_studio;
mod local_native;
mod openai;
mod openai_compatible;
mod response;
mod thinking;
use crate::adapters::model_http::Transport;
use crate::modules::{
    inference::{CallFuture, Completion, CompletionInput, ModelClient},
    model_registry::{Credentials, ProviderKind},
};
#[derive(Clone)]
pub(crate) struct ProviderClient(Transport);
impl ProviderClient {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self(Transport::new()?))
    }
}
impl ModelClient for ProviderClient {
    fn models(&self, c: Credentials) -> CallFuture<Vec<String>> {
        let t = self.0.clone();
        Box::pin(async move {
            match c.kind {
                k if k.is_system() => Err(crate::modules::inference::Error::Unsupported(
                    "System One 연결은 Decision 서비스를 사용하세요.",
                )),
                ProviderKind::Claude => claude::models(&t, &c).await,
                ProviderKind::Gemini => gemini::models(&t, &c).await,
                ProviderKind::LmStudioNative | ProviderKind::LmStudio => {
                    crate::adapters::model_http::lm_studio_models::list(&t, c, false).await
                }
                ProviderKind::Sglang => local_native::sglang_models(&t, &c).await,
                ProviderKind::LlamaCpp => openai_compatible::models(&t, &c, "v1/models").await,
                ProviderKind::Openai
                | ProviderKind::OpenaiCompatible
                | ProviderKind::Vllm
                | ProviderKind::Litellm => openai_compatible::models(&t, &c, "models").await,
                _ => Err(crate::modules::inference::Error::Unsupported(
                    "System One 연결은 Decision 서비스를 사용하세요.",
                )),
            }
        })
    }
    fn complete(&self, c: Credentials, i: CompletionInput) -> CallFuture<Completion> {
        let t = self.0.clone();
        Box::pin(async move {
            let c = crate::adapters::model_http::lm_load::resolve(&t, c).await?;
            let off = c.thinking.enabled == Some(false);
            let reply = match c.kind {
                ProviderKind::Openai => openai::complete(&t, &c, i).await,
                ProviderKind::Claude => claude::complete(&t, &c, i).await,
                ProviderKind::Gemini => gemini::complete(&t, &c, i).await,
                ProviderKind::LmStudioNative => lm_studio::complete(&t, &c, i).await,
                ProviderKind::LlamaCpp => local_native::llama(&t, &c, i).await,
                ProviderKind::Sglang => local_native::sglang(&t, &c, i).await,
                ProviderKind::LmStudio
                | ProviderKind::OpenaiCompatible
                | ProviderKind::Vllm
                | ProviderKind::Litellm => openai_compatible::complete(&t, &c, i).await,
                _ => Err(crate::modules::inference::Error::Unsupported(
                    "System One 연결은 Decision 서비스를 사용하세요.",
                )),
            }?;
            if off && reply.reasoned {
                return Err(crate::modules::inference::Error::Unsupported(
                    "서버가 Thinking 끄기 요청에도 추론을 수행했습니다. 다른 모델이나 설정을 선택하세요.",
                ));
            }
            Ok(reply)
        })
    }
}
