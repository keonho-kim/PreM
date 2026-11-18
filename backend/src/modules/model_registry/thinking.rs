// Purpose: Represent optional reasoning settings for one immutable provider revision.
// Pattern: Unset preserves the model default. Decision bridges explicitly request off.
// Usage: Registry validates the combination; protocol adapters encode it.
// Related: adapters/llm/thinking.rs, migrations/V2__provider_thinking.sql.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
}
impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|e| e.as_str() == s)
    }
    pub const ALL: [Self; 4] = [Self::Low, Self::Medium, Self::High, Self::Xhigh];
}
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Thinking {
    pub enabled: Option<bool>,
    pub effort: Option<Effort>,
}
impl Thinking {
    pub const OFF: Self = Self {
        enabled: Some(false),
        effort: None,
    };
}
