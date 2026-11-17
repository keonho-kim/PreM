// Purpose: Build bounded document classification questions.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: prompts/documents.rs, mod.rs.
use super::*;
pub(super) fn batch(blocks: Vec<Block>) -> Result<(Batch, Vec<(String, Uuid)>), Error> {
    let mut batch = Batch {
        state: serde_json::json!({"regions":{}}),
        questions: BTreeMap::new(),
    };
    let mut selected = Vec::new();
    for block in blocks.into_iter().take(16) {
        let key = format!("r{}", selected.len());
        let mut candidate = batch.clone();
        candidate.state["regions"][&key] = serde_json::json!({"text":block.text,"kind":block.kind});
        candidate.questions.insert(
            key.clone(),
            Question::Choice {
                instructions: format!(
                    "{} 대상: state.regions.{key}",
                    crate::prompts::documents::CONTENTS
                ),
                criteria: crate::prompts::documents::CRITERIA
                    .into_iter()
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect(),
            },
        );
        if serde_json::to_vec(&candidate)
            .map_err(|_| Error::Storage)?
            .len()
            > 28 * 1024
        {
            break;
        }
        batch = candidate;
        selected.push((key, block.id));
    }
    if selected.is_empty() {
        return Err(Error::Processing("decision_input_limit"));
    }
    Ok((batch, selected))
}
