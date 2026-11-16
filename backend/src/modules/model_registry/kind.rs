// Purpose: Own supported provider identities, setup defaults and implemented capabilities.
// Pattern: Typed exhaustive variants with one descriptor shared by execution and HTTP catalog.
// Usage: Parse at HTTP/SQLite boundaries; Admin reads this catalog instead of copying rules.
// Related: mod.rs, adapters/http/provider_catalog.rs, adapters/llm/mod.rs.
use super::Error;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderKind {
    LmStudioNative,
    Typesafe,
    LmStudioDecision,
    LlamaDecision,
    SglangDecision,
    VllmDecision,
    VllmSrDecision,
    LitellmDecision,
    OpenaiDecision,
    GeminiDecision,
    Openai,
    Claude,
    Gemini,
    LlamaCpp,
    Sglang,
    Vllm,
    Litellm,
    LmStudio,
    OpenaiCompatible,
}
pub(crate) struct ProviderDescriptor {
    pub category: &'static str,
    pub id: &'static str,
    pub label: &'static str,
    pub protocol: &'static str,
    pub base: &'static str,
    pub model: &'static str,
    pub structured: bool,
    pub key: bool,
    pub structured_reason: Option<&'static str>,
}
impl ProviderKind {
    pub const ALL: &[Self] = &[
        Self::LmStudioNative,
        Self::Openai,
        Self::Claude,
        Self::Gemini,
        Self::LlamaCpp,
        Self::Sglang,
        Self::Vllm,
        Self::Litellm,
        Self::LmStudio,
        Self::OpenaiCompatible,
        Self::Typesafe,
        Self::LmStudioDecision,
        Self::LlamaDecision,
        Self::SglangDecision,
        Self::VllmDecision,
        Self::VllmSrDecision,
        Self::LitellmDecision,
        Self::OpenaiDecision,
        Self::GeminiDecision,
    ];
    pub fn descriptor(self) -> ProviderDescriptor {
        if let Some(d) = super::decision_catalog::descriptor(self) {
            return d;
        }
        match self {
            Self::LmStudioNative => ProviderDescriptor {
                category: "llm",
                id: "lm_studio_native",
                label: "LM Studio Native",
                protocol: "Native Chat",
                base: "http://127.0.0.1:1234/api/v1",
                model: "ornith-1.5-35b-a3b",
                structured: false,
                key: false,
                structured_reason: Some(
                    "LM Studio Native API에는 JSON Schema 생성 옵션이 없습니다. 구조화 생성은 명시적으로 OpenAI 호환 연결을 선택하세요.",
                ),
            },
            Self::Openai => ProviderDescriptor {
                category: "llm",
                id: "openai",
                label: "OpenAI",
                protocol: "Responses API",
                base: "https://api.openai.com/v1",
                model: "",
                structured: true,
                key: true,
                structured_reason: None,
            },
            Self::Claude => ProviderDescriptor {
                category: "llm",
                id: "claude",
                label: "Claude",
                protocol: "Messages API",
                base: "https://api.anthropic.com/v1",
                model: "",
                structured: true,
                key: true,
                structured_reason: None,
            },
            Self::Gemini => ProviderDescriptor {
                category: "llm",
                id: "gemini",
                label: "Gemini",
                protocol: "generateContent",
                base: "https://generativelanguage.googleapis.com/v1beta",
                model: "",
                structured: true,
                key: true,
                structured_reason: None,
            },
            Self::LlamaCpp => ProviderDescriptor {
                category: "llm",
                id: "llama_cpp",
                label: "llama.cpp",
                protocol: "apply-template / completion",
                base: "http://127.0.0.1:8080",
                model: "",
                structured: true,
                key: false,
                structured_reason: None,
            },
            Self::Sglang => ProviderDescriptor {
                category: "llm",
                id: "sglang",
                label: "SGLang",
                protocol: "tokenize / generate",
                base: "http://127.0.0.1:30000",
                model: "",
                structured: true,
                key: false,
                structured_reason: None,
            },
            Self::Vllm => ProviderDescriptor {
                category: "llm",
                id: "vllm",
                label: "vLLM",
                protocol: "공식 OpenAI 호환 API",
                base: "http://127.0.0.1:8001/v1",
                model: "",
                structured: true,
                key: false,
                structured_reason: None,
            },
            Self::Litellm => ProviderDescriptor {
                category: "llm",
                id: "litellm",
                label: "LiteLLM",
                protocol: "공식 OpenAI 호환 API",
                base: "http://127.0.0.1:4000/v1",
                model: "",
                structured: true,
                key: false,
                structured_reason: None,
            },
            Self::LmStudio => ProviderDescriptor {
                category: "llm",
                id: "lm_studio",
                label: "LM Studio · OpenAI 호환",
                protocol: "Chat Completions",
                base: "http://127.0.0.1:1234/v1",
                model: "ornith-1.5-35b-a3b",
                structured: true,
                key: false,
                structured_reason: None,
            },
            Self::OpenaiCompatible => ProviderDescriptor {
                category: "llm",
                id: "openai_compatible",
                label: "기타 OpenAI 호환 서버",
                protocol: "Chat Completions",
                base: "http://127.0.0.1:1234/v1",
                model: "",
                structured: true,
                key: false,
                structured_reason: None,
            },
            _ => unreachable!("decision catalog covers decision kinds"),
        }
    }
    pub fn is_system(self) -> bool {
        self.descriptor().category == "system"
    }
    pub fn as_str(self) -> &'static str {
        self.descriptor().id
    }
}
impl std::str::FromStr for ProviderKind {
    type Err = Error;
    fn from_str(value: &str) -> Result<Self, Error> {
        Self::ALL
            .iter()
            .copied()
            .find(|kind| kind.as_str() == value)
            .ok_or(Error::Invalid("지원하는 연결 방식을 선택하세요."))
    }
}
