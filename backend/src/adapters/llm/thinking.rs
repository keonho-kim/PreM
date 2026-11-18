// Purpose: Encode the optional per-request thinking policy in each provider's wire format.
// Pattern: Reasoning options apply to the chat template for native token/completion servers.
// Usage: Called after output schemas are attached so structured output and thinking coexist.
// Related: model_registry/thinking.rs, decisions/llm.rs, dev-docs/06-development-operations.md.
use crate::modules::model_registry::{Credentials, ProviderKind as K};
use serde_json::{Value, json};

pub(super) fn apply(body: &mut Value, c: &Credentials) {
    let Some(on) = c.thinking.enabled else { return };
    let effort = if c.probe_effort_validation {
        Some("prem_invalid_effort")
    } else {
        c.thinking.effort.map(|e| e.as_str())
    };
    let level = if on {
        effort.unwrap_or("medium")
    } else {
        "none"
    };
    match c.kind {
        K::Openai => body["reasoning"] = json!({"effort": level}),
        K::Claude => {
            body["thinking"] = json!({"type": if on { "adaptive" } else { "disabled" }});
            if let Some(value) = effort {
                body["output_config"]["effort"] = json!(value);
            }
        }
        K::Gemini => {
            let config = if !on {
                json!({"thinkingBudget":0})
            } else if let Some(value) = effort {
                json!({"thinkingLevel":value.to_ascii_uppercase()})
            } else if c
                .model_identifier
                .trim_start_matches("models/")
                .starts_with("gemini-2.")
            {
                json!({"thinkingBudget":-1})
            } else {
                json!({"thinkingLevel":"HIGH"})
            };
            body["generationConfig"]["thinkingConfig"] = config;
        }
        K::LmStudioNative => {
            body["reasoning"] = json!(if on { effort.unwrap_or("on") } else { "off" })
        }
        K::LlamaCpp | K::Sglang | K::Vllm => {
            body["chat_template_kwargs"] = json!({"enable_thinking":on});
            if let Some(value) = effort {
                body["reasoning_effort"] = json!(value);
            }
        }
        K::LmStudio => {
            body["reasoning_effort"] = json!(if on { effort.unwrap_or("on") } else { "none" })
        }
        K::Litellm | K::OpenaiCompatible => body["reasoning_effort"] = json!(level),
        // Dedicated Decision protocols have no generation controls.
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::model_registry::{Effort, Thinking};
    use uuid::Uuid;
    #[test]
    fn maps_controls_by_protocol_and_preserves_schemas_and_defaults() {
        let mut c = Credentials {
            connection_id: Uuid::nil(),
            config_id: Uuid::nil(),
            kind: K::Openai,
            base_url: String::new(),
            model_identifier: "fixture".into(),
            timeout_seconds: 10,
            max_output_tokens: None,
            context_length: None,
            physical_batch_size: None,
            token: None,
            thinking: Thinking::default(),
            probe_effort_validation: false,
        };
        for (kind, path, off_path, off) in [
            (
                K::Openai,
                "/reasoning/effort",
                "/reasoning/effort",
                json!("none"),
            ),
            (
                K::Claude,
                "/output_config/effort",
                "/thinking/type",
                json!("disabled"),
            ),
            (
                K::Gemini,
                "/generationConfig/thinkingConfig/thinkingLevel",
                "/generationConfig/thinkingConfig/thinkingBudget",
                json!(0),
            ),
            (K::LmStudioNative, "/reasoning", "/reasoning", json!("off")),
            (
                K::LmStudio,
                "/reasoning_effort",
                "/reasoning_effort",
                json!("none"),
            ),
            (
                K::OpenaiCompatible,
                "/reasoning_effort",
                "/reasoning_effort",
                json!("none"),
            ),
            (
                K::Litellm,
                "/reasoning_effort",
                "/reasoning_effort",
                json!("none"),
            ),
            (
                K::Vllm,
                "/reasoning_effort",
                "/chat_template_kwargs/enable_thinking",
                json!(false),
            ),
            (
                K::Sglang,
                "/reasoning_effort",
                "/chat_template_kwargs/enable_thinking",
                json!(false),
            ),
            (
                K::LlamaCpp,
                "/reasoning_effort",
                "/chat_template_kwargs/enable_thinking",
                json!(false),
            ),
        ] {
            c.kind = kind;
            let original = json!({"output_config":{"format":{"type":"json_schema"}}});
            let mut body = original.clone();
            c.thinking = Thinking::default();
            apply(&mut body, &c);
            assert_eq!(body, original);
            c.thinking = Thinking {
                enabled: Some(true),
                effort: Some(Effort::High),
            };
            apply(&mut body, &c);
            assert_eq!(
                body.pointer(path),
                Some(&json!(if kind == K::Gemini { "HIGH" } else { "high" }))
            );
            assert_eq!(
                body["output_config"]["format"],
                original["output_config"]["format"]
            );
            let mut body = original;
            c.thinking = Thinking::OFF;
            apply(&mut body, &c);
            assert_eq!(body.pointer(off_path), Some(&off));
        }
        for &kind in K::ALL.iter().filter(|k| k.is_system()) {
            c.kind = kind;
            c.thinking = Thinking::OFF;
            let mut body = json!({});
            apply(&mut body, &c);
            assert_eq!(body, json!({}));
        }
    }
}
