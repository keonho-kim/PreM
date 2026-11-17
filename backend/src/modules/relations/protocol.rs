// Purpose: Build compact batched relationship questions and exact-input cache identities.
// Pattern: One shared context per call, bounded candidate text and numeric choice outputs.
// Usage: Worker checks cache before sending missing candidates through Decisions.
// Related: worker.rs, types.rs, modules/decisions/validation.rs.
use super::*;
use crate::modules::decisions::{Batch, Question};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
pub(super) struct Group {
    pub batch: Batch,
    pub keys: Vec<(String, Uuid, String)>,
    pub context_hash: String,
}
pub(crate) fn hash(v: &impl serde::Serialize) -> String {
    hex::encode(Sha256::digest(
        serde_json::to_vec(v).expect("serializable relation input"),
    ))
}
pub(crate) fn clip(s: &str, bytes: usize) -> String {
    s[..s.floor_char_boundary(bytes.min(s.len()))].to_owned()
}
pub(super) fn key(context: &serde_json::Value, c: &Candidate, config: Uuid) -> String {
    if !c.read_ids.is_empty() || context.get("workspace_evidence").is_some() {
        return hash(
            &json!({"definition":"business-relations-context-v2","context":context,"kind":c.kind,"extraction":c.extraction,"block":c.block,"reads":c.read_ids,"text":c.text,"config":config}),
        );
    }
    hash(
        &json!({"definition":"business-relations-v1","context":context,"kind":c.kind,"extraction":c.extraction,"block":c.block,"text":c.text,"config":config}),
    )
}
pub(super) fn groups(plan: Plan, config: Uuid, max_questions: usize) -> Result<Vec<Group>, Error> {
    let context_hash = hash(&plan.context);
    let mut wire_context = plan.context.clone();
    if let Some(documents) = wire_context["documents"].as_array_mut() {
        for document in documents {
            if let Some(fields) = document.as_object_mut() {
                fields.remove("id");
            }
        }
    }
    let mut result = Vec::new();
    let empty = || Group {
        batch: Batch {
            state: json!({"current":wire_context,"candidates":{}}),
            questions: BTreeMap::new(),
        },
        keys: Vec::new(),
        context_hash: context_hash.clone(),
    };
    let mut group = empty();
    for (ordinal, candidate) in plan.candidates.into_iter().enumerate() {
        let question = format!("c{ordinal}");
        let cache_key = key(&plan.context, &candidate, config);
        let extra =
            if candidate.read_ids.is_empty() && plan.context.get("workspace_evidence").is_none() {
                ""
            } else {
                crate::prompts::relations::REVIEW
            };
        let add = |g: &mut Group| {
            g.batch.state["candidates"][&question] =
                json!({"kind":candidate.kind,"text":candidate.text});
            g.batch.questions.insert(
                question.clone(),
                Question::Choice {
                    instructions: format!(
                        "{} 대상: state.current와 state.candidates.{question}. {extra}",
                        crate::prompts::relations::CLASSIFY
                    ),
                    criteria: crate::prompts::relations::CRITERIA
                        .into_iter()
                        .map(|(k, v)| (k.into(), v.into()))
                        .collect(),
                },
            );
            g.keys
                .push((question.clone(), candidate.id, cache_key.clone()));
        };
        let mut trial = Group {
            batch: group.batch.clone(),
            keys: group.keys.clone(),
            context_hash: context_hash.clone(),
        };
        add(&mut trial);
        if group.keys.len() == max_questions.clamp(1, 8)
            || serde_json::to_vec(&trial.batch)
                .map_err(|_| Error::Storage)?
                .len()
                > 28 * 1024
        {
            if group.keys.is_empty() {
                return Err(Error::Invalid);
            }
            result.push(group);
            group = empty();
            add(&mut group);
        } else {
            group = trial;
        }
        group.batch.validate().map_err(|_| Error::Invalid)?;
    }
    if !group.keys.is_empty() {
        result.push(group)
    }
    Ok(result)
}
