// Purpose: Own slide editing request rules.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: prompts/editing.rs, commands.rs.
use super::*;
use serde_json::json;
pub(in crate::modules::presentations) fn input(
    edit: &Edit,
    plan: &EditPlan,
) -> Result<crate::modules::inference::CompletionInput, Error> {
    if edit
        .object_ids
        .iter()
        .any(|id| !plan.original.objects.iter().any(|o| &o.id == id))
    {
        return Err(Error::EditInvalid);
    }
    let mut properties = serde_json::Map::new();
    for field in &edit.fields {
        properties.insert(field.clone(),match field.as_str(){
            "objects"=>super::super::object_schema::objects(&edit.media,&edit.references),
            "layout"=>super::super::object_schema::layout(),
            "bullets"=>json!({"type":"array","minItems":1,"maxItems":5,"items":{"type":"string","maxLength":90}}),
            _=>json!({"type":"string","maxLength":if field=="title"{60}else{800}}),
        });
    }
    for property in properties.values_mut() {
        *property = json!({"anyOf":[property.clone(),{"type":"null"}]});
    }
    let schema = json!({"type":"object","additionalProperties":false,"required":["tool","message","changes"],"properties":{"tool":{"type":"string","enum":["propose_slide_patch"]},"message":{"type":"string","maxLength":500},"changes":{"type":"object","additionalProperties":false,"required":edit.fields,"properties":properties}}});
    let task = format!(
        "{}\n{}",
        crate::prompts::editing::PATCH,
        crate::prompts::editing::OBJECTS
    );
    let system = crate::prompts::structured(&task, &schema);
    let context = json!({"task":"slide_edit","user_request":edit.prompt,"selected_fields":edit.fields,"current_slide":plan.original,"context":plan.context,"selected_object_ids":edit.object_ids,"available_images":edit.media,"batch_slide_count":edit.targets.len()});
    let prompt = crate::modules::inference::bounded_context(
        &context,
        &["/context/source_excerpts", "/context/available_references"],
        24576_usize.saturating_sub(system.len()),
    )
    .ok_or(Error::Processing("edit_input_limit"))?;
    Ok(crate::modules::inference::CompletionInput {
        system,
        prompt,
        schema: Some(schema),
        max_tokens: 4096,
    })
}
