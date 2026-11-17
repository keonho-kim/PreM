// Purpose: Compose one evidence-bound slide writing request.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: prompts/presentations.rs, inference/context.rs.
use super::*;
use serde_json::json;
pub(in crate::modules::presentations) fn input(
    plan: &Plan,
) -> Result<crate::modules::inference::CompletionInput, Error> {
    let mut schema = json!({"type":"object","additionalProperties":false,"required":["schema_version","title","bullets","notes","block_ids"],"properties":{
      "schema_version":{"type":"integer","enum":[1]},"title":{"type":"string"},"bullets":{"type":"array","items":{"type":"string"}},"notes":{"type":"string"},"block_ids":{"type":"array","items":{"type":"string","enum":plan.block_ids}}
    }});
    super::template::schema(plan, &mut schema);
    let system = crate::prompts::structured(crate::prompts::presentations::WRITE, &schema);
    let prompt = crate::modules::inference::bounded_context(
        &plan.context,
        &["/sources"],
        30000_usize.saturating_sub(system.len()),
    )
    .ok_or(Error::Processing("input_limit"))?;
    Ok(crate::modules::inference::CompletionInput {
        system,
        prompt,
        schema: Some(schema),
        // Reasoning-capable models share this budget with their final structured answer.
        // A short slide still needs enough room to finish JSON after bounded reasoning.
        max_tokens: 4096,
    })
}
