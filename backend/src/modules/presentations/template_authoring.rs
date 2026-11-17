// Purpose: Fit model-authored text and selected assets into actual pinned template slots.
// Pattern: Native template geometry owns placement; model choices stay within its layout/slot catalog.
// Usage: Presentation write stage enriches context and validates every generated slot before saving.
// Related: model.rs, presentation-canvas.py, object_schema.rs, worker.rs.
use super::*;
use serde_json::{Value, json};
fn extras(layout: &CanvasLayout) -> impl Iterator<Item = &TemplateSlot> {
    let body = layout
        .slots
        .iter()
        .find(|s| s.role == "body")
        .map(|s| s.id.as_str());
    layout
        .slots
        .iter()
        .filter(move |s| s.role != "title" && Some(s.id.as_str()) != body)
}
pub(super) fn prepare(plan: &mut Plan) -> Result<(), Error> {
    if plan.layouts.is_empty() {
        return Ok(());
    }
    plan.layouts.retain(|l| {
        let title = l.slots.iter().any(|s| s.role == "title");
        let body = l.slots.iter().filter(|s| s.role == "body").count();
        let art = l
            .slots
            .iter()
            .filter(|s| ["image", "chart", "table"].contains(&s.role.as_str()))
            .count()
            + body.saturating_sub(1);
        title && body > 0 && art >= plan.materials.len()
    });
    let mut bytes = 0;
    let mut count = 0;
    plan.layouts.retain(|l| {
        let size = serde_json::to_vec(l).map_or(usize::MAX, |v| v.len());
        if count >= 12 || bytes + size > 10000 {
            return false;
        }
        bytes += size;
        count += 1;
        true
    });
    if plan.layouts.is_empty() {
        return Err(Error::Processing("template_slot_capacity"));
    }
    let layouts: Vec<_> = plan.layouts.iter().map(|l| json!({"key":l.key,"name":l.name,"title_slot":l.slots.iter().find(|s|s.role=="title"),"body_slot":l.slots.iter().find(|s|s.role=="body"),"additional_slots":extras(l).collect::<Vec<_>>()})).collect();
    plan.context["template"] = json!({"layouts":layouts,"selected_materials":plan.materials.iter().map(|m|json!({"reference_id":m.id,"title":m.title,"kind":m.kind})).collect::<Vec<_>>(),"policy":"Choose one available layout. Root title and bullets already fill title_slot and body_slot; NEVER repeat them as objects. design.objects contains only additional content in that layout's additional_slots. Use [] when no extra content or selected material is needed. The server assigns exact native frames; preserve template colors/styles. Shorten authored wording to max_chars; never truncate original source text or invent data. Include every selected reference exactly once."});
    Ok(())
}
pub(super) fn schema(plan: &Plan, schema: &mut Value) {
    if plan.layouts.is_empty() {
        return;
    }
    schema["required"]
        .as_array_mut()
        .unwrap()
        .push(json!("design"));
    schema["properties"]["schema_version"] = json!({"type":"integer","enum":[4]});
    let variants: Vec<_> = plan.layouts.iter().map(|l| {
        let slots: Vec<_> = extras(l).filter_map(|s| {
            let mut content = vec![];
            if s.role == "body" {
                content.push(json!({"type":"object","additionalProperties":false,"required":["kind","text"],"properties":{"kind":{"type":"string","enum":["text"]},"text":{"type":"string","maxLength":s.max_chars}}}));
            }
            if !plan.materials.is_empty() {
                content.push(json!({"type":"object","additionalProperties":false,"required":["kind","reference_id"],"properties":{"kind":{"type":"string","enum":["reference"]},"reference_id":{"type":"string","enum":plan.materials.iter().map(|m|m.id).collect::<Vec<_>>()}}}));
            }
            (!content.is_empty()).then(||json!({"type":"object","additionalProperties":false,"required":["slot_id","content"],"properties":{"slot_id":{"type":"string","enum":[s.id]},"content":{"anyOf":content}}}))
        }).collect();
        let objects = if slots.is_empty() {json!({"type":"array","maxItems":0,"items":{"type":"string"}})} else {json!({"type":"array","maxItems":20,"items":{"anyOf":slots}})};
        json!({"type":"object","additionalProperties":false,"required":["layout_key","authored","objects"],"properties":{"layout_key":{"type":"string","enum":[l.key]},"authored":{"type":"boolean","enum":[false]},"objects":objects}})
    }).collect();
    schema["properties"]["design"] = json!({"anyOf":variants});
}
pub(super) fn decode(plan: &Plan, text: &str) -> Result<SlideSpec, Error> {
    if plan.layouts.is_empty() {
        return serde_json::from_str(text).map_err(|_| Error::Processing("invalid_slide"));
    }
    let mut data: Value =
        serde_json::from_str(text).map_err(|_| Error::Processing("invalid_template_slide"))?;
    let key = data["design"]["layout_key"]
        .as_str()
        .ok_or(Error::Processing("invalid_template_slide"))?;
    let layout = plan
        .layouts
        .iter()
        .find(|l| l.key == key)
        .ok_or(Error::Processing("invalid_template_slide"))?;
    let entries = data["design"]["objects"]
        .as_array()
        .ok_or(Error::Processing("invalid_template_slide"))?;
    let mut objects = vec![];
    if entries.len() > 20 {
        return Err(Error::Processing("invalid_template_slide"));
    }
    for entry in entries {
        let row = entry
            .as_object()
            .ok_or(Error::Processing("invalid_template_slot"))?;
        if row.len() != 2 {
            return Err(Error::Processing("invalid_template_slot"));
        }
        let id = entry["slot_id"]
            .as_str()
            .ok_or(Error::Processing("invalid_template_slot"))?;
        let slot = layout
            .slots
            .iter()
            .find(|s| s.id == id)
            .ok_or(Error::Processing("invalid_template_slot"))?;
        let content = &entry["content"];
        if content.as_object().is_none_or(|o| o.len() != 2) {
            return Err(Error::Processing("invalid_template_slot"));
        }
        let content = match content["kind"].as_str() {
            Some("text") => ObjectContent::Text {
                text: content["text"]
                    .as_str()
                    .ok_or(Error::Processing("invalid_template_slot"))?
                    .into(),
                font_size: (slot.font_size * 0.75).clamp(8., 72.),
                color: "#262824".into(),
            },
            Some("reference") => ObjectContent::Reference {
                reference_id: content["reference_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .ok_or(Error::Processing("invalid_template_slot"))?,
            },
            _ => return Err(Error::Processing("invalid_template_slot")),
        };
        objects.push(SlideObject {
            id: id.into(),
            name: if slot.role == "body" {
                "추가 본문".into()
            } else {
                "참고 자료".into()
            },
            frame: slot.frame.clone(),
            content,
        });
    }
    data["objects"] = serde_json::to_value(objects).map_err(|_| Error::Storage)?;
    data["design"]
        .as_object_mut()
        .ok_or(Error::Processing("invalid_template_slide"))?
        .remove("objects");
    serde_json::from_value(data).map_err(|_| Error::Processing("invalid_template_slide"))
}
pub(super) fn validate(plan: &Plan, spec: &SlideSpec) -> Result<(), Error> {
    if plan.layouts.is_empty() {
        if spec.design.is_some() {
            return Err(Error::Processing("invalid_slide"));
        }
        return Ok(());
    }
    let design = spec
        .design
        .as_ref()
        .ok_or(Error::Processing("invalid_template_slide"))?;
    if design.authored || spec.schema_version != 4 || spec.layout.is_some() {
        return Err(Error::Processing("invalid_template_slide"));
    }
    let layout = plan
        .layouts
        .iter()
        .find(|l| l.key == design.layout_key)
        .ok_or(Error::Processing("invalid_template_slide"))?;
    let title = layout
        .slots
        .iter()
        .find(|s| s.role == "title")
        .ok_or(Error::Processing("invalid_template_slide"))?;
    let body = layout
        .slots
        .iter()
        .find(|s| s.role == "body")
        .ok_or(Error::Processing("invalid_template_slide"))?;
    if spec.title.chars().count() > title.max_chars
        || spec
            .bullets
            .iter()
            .map(|s| s.chars().count())
            .sum::<usize>()
            > body.max_chars
    {
        return Err(Error::Processing("template_text_capacity"));
    }
    let mut used = std::collections::HashSet::new();
    for object in &spec.objects {
        let slot = layout
            .slots
            .iter()
            .find(|s| s.id == object.id && s.id != title.id && s.id != body.id)
            .ok_or(Error::Processing("invalid_template_slot"))?;
        if object.frame != slot.frame {
            return Err(Error::Processing("invalid_template_slot"));
        }
        match &object.content {
            ObjectContent::Text { text, .. }
                if slot.role == "body" && text.chars().count() <= slot.max_chars => {}
            ObjectContent::Reference { reference_id }
                if plan.materials.iter().any(|m| m.id == *reference_id)
                    && used.insert(*reference_id) => {}
            _ => return Err(Error::Processing("invalid_template_slot")),
        }
    }
    if used.len() != plan.materials.len() {
        return Err(Error::Processing("template_material_missing"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "template_authoring_tests.rs"]
mod tests;
