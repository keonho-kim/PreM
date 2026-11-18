// Purpose: Implement the decision port using an existing generation model client.
// Pattern: One bounded batch, dynamic enum schema, no invented probability estimates.
// Usage: Selected LLM connections; never a silent fallback from native decisions.
// Related: modules/decisions/, modules/inference/ports.rs, mod.rs.
use crate::modules::{
    decisions::{Answer, Batch, Evaluation},
    inference::{CompletionInput, ModelClient},
    model_execution::{Error, Outcome},
    model_registry::Credentials,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
pub(super) async fn evaluate(
    client: Arc<dyn ModelClient>,
    mut c: Credentials,
    batch: Batch,
) -> Result<Outcome<Evaluation>, Error> {
    if !c.kind.descriptor().structured {
        return Err(Error::Unsupported(
            "이 LLM 연결은 구조화 출력이 없습니다. 호환 연결을 명시적으로 선택하세요.",
        ));
    }
    let properties: serde_json::Map<String, Value> = batch.questions.iter().map(|(id,q)| (id.clone(), json!({"type":"object","properties":{"type":{"type":"string","enum":["choice"]},"choice":{"type":"string","enum":q.criteria().keys().collect::<Vec<_>>()}},"required":["type","choice"],"additionalProperties":false}))).collect();
    let schema = json!({"type":"object","properties":{"answers":{"type":"object","properties":properties,"required":batch.questions.keys().collect::<Vec<_>>(),"additionalProperties":false}},"required":["answers"],"additionalProperties":false});
    c.thinking = crate::modules::model_registry::Thinking::OFF;
    let model = c.model_identifier.clone();
    let input = CompletionInput {
        system: crate::prompts::decisions::EVALUATE.into(),
        prompt: serde_json::to_string(&batch).map_err(|_| Error::InvalidResponse)?,
        schema: Some(schema.clone()),
        max_tokens: c.max_output_tokens.unwrap_or(2048),
    };
    let r = client.complete(c, input).await?;
    let v: Value = crate::adapters::model_http::parse_json(r.text.as_bytes())
        .map_err(|_| Error::InvalidResponse)?;
    if !jsonschema::is_valid(&schema, &v) {
        return Err(Error::InvalidResponse);
    }
    let answers = v["answers"]
        .as_object()
        .ok_or(Error::InvalidResponse)?
        .iter()
        .map(|(id, a)| {
            Ok((
                id.clone(),
                Answer {
                    choice: a["choice"].as_str().ok_or(Error::InvalidResponse)?.into(),
                    probabilities: None,
                    confidence: None,
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>, Error>>()?;
    Ok(Outcome {
        value: Evaluation {
            answers,
            model,
            statistics: "unavailable",
        },
        input_tokens: r.prompt_tokens,
        output_tokens: r.completion_tokens,
    })
}
