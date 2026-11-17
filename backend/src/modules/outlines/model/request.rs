// Purpose: Build outline generation or mapping requests.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: prompts/outlines.rs, inference/context.rs.
use super::*;
use serde_json::json;
pub(in crate::modules::outlines) fn input(
    run: &Run,
    plan: &Plan,
) -> Result<crate::modules::inference::CompletionInput, Error> {
    let block_keys: Vec<_> = plan.blocks.iter().map(|v| v.0.clone()).collect();
    let node_keys: Vec<_> = plan.nodes.iter().map(|v| v.0.clone()).collect();
    let schema = if run.kind == "generate" {
        json!({"type":"object","additionalProperties":false,"required":["nodes"],"properties":{"nodes":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["key","parent_key","title","description","block_keys"],"properties":{"key":{"type":"string"},"parent_key":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"block_keys":{"type":"array","items":{"type":"string","enum":block_keys}}}}}}})
    } else {
        json!({"type":"object","additionalProperties":false,"required":["assignments"],"properties":{"assignments":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["block_key","node_keys"],"properties":{"block_key":{"type":"string","enum":block_keys},"node_keys":{"type":"array","items":{"type":"string","enum":node_keys}}}}}}})
    };
    let task = if run.kind == "generate" {
        crate::prompts::outlines::GENERATE
    } else {
        crate::prompts::outlines::MAP
    };
    let system = crate::prompts::structured(task, &schema);
    let prompt = crate::modules::inference::bounded_context(
        &plan.context,
        &["/source_excerpts"],
        32768_usize.saturating_sub(system.len()),
    )
    .ok_or(Error::Model("outline_input_limit"))?;
    Ok(crate::modules::inference::CompletionInput {
        system,
        prompt,
        schema: Some(schema),
        max_tokens: 4096,
    })
}
