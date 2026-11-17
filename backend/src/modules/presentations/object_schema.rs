// Purpose: Describe the bounded object language to native structured-output providers.
// Pattern: Explicit schemas mirror domain validation without exposing arbitrary capabilities.
// Usage: Editing prompt only; server validation remains authoritative.
// Related: objects.rs, editing/request.rs.
use super::Media;
use serde_json::{Value, json};
fn object(properties: Value) -> Value {
    let required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
    json!({"type":"object","additionalProperties":false,"required":required,"properties":properties})
}
pub(super) fn frame() -> Value {
    object(
        json!({"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number"},"height":{"type":"number"},"rotation":{"type":"number"}}),
    )
}
pub(super) fn layout() -> Value {
    object(json!({"title":frame(),"body":frame()}))
}
pub(super) fn objects(media: &[Media], references: &[super::ImportedMaterial]) -> Value {
    let string = json!({"type":"string"});
    let mut content = vec![
        object(
            json!({"kind":{"type":"string","enum":["text"]},"text":string,"font_size":{"type":"number"},"color":string}),
        ),
        object(
            json!({"kind":{"type":"string","enum":["shape"]},"shape":{"type":"string","enum":["rectangle","ellipse"]},"fill":string}),
        ),
        object(
            json!({"kind":{"type":"string","enum":["chart"]},"chart_type":{"type":"string","enum":["column","bar","line","pie"]},"title":string,"categories":{"type":"array","items":string},"series":{"type":"array","items":object(json!({"name":string,"values":{"type":"array","items":{"type":"number"}}}))}}),
        ),
    ];
    if !media.is_empty() {
        content.push(object(json!({"kind":{"type":"string","enum":["image"]},"media_id":{"type":"string","enum":media.iter().map(|m|m.id).collect::<Vec<_>>()}})));
    }
    if !references.is_empty() {
        content.push(object(json!({"kind":{"type":"string","enum":["reference"]},"reference_id":{"type":"string","enum":references.iter().map(|m|m.id).collect::<Vec<_>>()}})));
    }
    json!({"type":"array","maxItems":20,"items":object(json!({"id":string,"name":string,"frame":frame(),"content":{"anyOf":content}}))})
}
