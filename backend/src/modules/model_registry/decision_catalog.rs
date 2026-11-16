// Purpose: Describe native decision connections separately from generation providers.
// Pattern: Catalog metadata reflects implemented protocols, not verified remote model support.
// Usage: Admin filters these entries under System One; execution selects the saved kind.
// Related: kind.rs, adapters/decisions/, dev-docs/08-dependencies.md.
use super::{ProviderDescriptor, ProviderKind as K};
pub(super) fn descriptor(kind: K) -> Option<ProviderDescriptor> {
    let (id, label, protocol, base, model, key) = match kind {
        K::Typesafe => (
            "typesafe",
            "TypeSafe Jev",
            "System One API",
            "https://api.typesafe.ai/v1",
            "jev-latest",
            true,
        ),
        K::LmStudioDecision => (
            "lm_studio_decision",
            "LM Studio",
            "System One · 판정 모델 필요",
            "http://127.0.0.1:1234/v1",
            "",
            false,
        ),
        K::LlamaDecision => (
            "llama_decision",
            "llama.cpp",
            "System One · 판정 모델 필요",
            "http://127.0.0.1:8080/v1",
            "",
            false,
        ),
        K::SglangDecision => (
            "sglang_decision",
            "SGLang",
            "System One · 서버/모델 확인 필요",
            "http://127.0.0.1:30000/v1",
            "",
            false,
        ),
        K::VllmDecision => (
            "vllm_decision",
            "vLLM",
            "System One · read strategy 확인 필요",
            "http://127.0.0.1:8001/v1",
            "",
            false,
        ),
        K::VllmSrDecision => (
            "vllm_sr_decision",
            "vLLM-SR",
            "System One · Semantic Router",
            "http://127.0.0.1:8100/v1",
            "",
            false,
        ),
        K::LitellmDecision => (
            "litellm_decision",
            "LiteLLM",
            "System One · 판정 배포 필요",
            "http://127.0.0.1:4000/v1",
            "",
            false,
        ),
        K::OpenaiDecision => (
            "openai_decision",
            "OpenAI",
            "Native Decisions API",
            "https://api.openai.com/v1",
            "gpt-6-luna",
            true,
        ),
        K::GeminiDecision => (
            "gemini_decision",
            "Gemini",
            "Native Decisions API · Beta",
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-decision-1",
            true,
        ),
        _ => return None,
    };
    Some(ProviderDescriptor {
        category: "system",
        id,
        label,
        protocol,
        base,
        model,
        key,
        structured: false,
        structured_reason: Some(
            "System One 연결은 판정 테스트를 사용합니다. 자유 텍스트 생성은 지원하지 않습니다.",
        ),
    })
}
