// Purpose: Supply deterministic object/batch responses for actual presentation integration tests.
// Pattern: Synthetic data only; canonical IDs are copied from the admitted prompt context.
// Usage: outline_support model fixture; production never uses these rules.
// Related: presentation_objects.rs, slide_edits.rs.
use serde_json::{Value, json};
pub(super) fn response(input: &Value, invalid: bool) -> Value {
    let mut changes = serde_json::Map::new();
    for field in input["selected_fields"].as_array().unwrap() {
        let name = field.as_str().unwrap();
        let value = match name {
            "title" => {
                if input["user_request"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("revision-"))
                {
                    input["user_request"].clone()
                } else {
                    json!("수정된 제목")
                }
            }
            "bullets" => json!(["간결하게 정리한 본문"]),
            "notes" => json!("수정한 발표 메모"),
            "layout" => {
                json!({"title":{"x":5,"y":10,"width":90,"height":15,"rotation":0},"body":{"x":5,"y":30,"width":40,"height":60,"rotation":0}})
            }
            "objects" if input["user_request"] == "레퍼런스 차트 넣어줘" => {
                let item = input["context"]["available_references"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|v| v["kind"] == "chart")
                    .unwrap();
                json!([{"id":"source-chart","name":"레퍼런스 차트","frame":{"x":55,"y":30,"width":40,"height":50,"rotation":0},"content":{"kind":"reference","reference_id":item["reference_id"]}}])
            }
            "objects" => {
                let ids = input["selected_object_ids"].as_array().unwrap();
                if !ids.is_empty() {
                    let objects: Vec<Value> = input["current_slide"]["objects"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|o| ids.contains(&o["id"]))
                        .map(|o| {
                            let mut o = o.clone();
                            o["frame"]["x"] = json!(50);
                            o
                        })
                        .collect();
                    json!(objects)
                } else {
                    let mut objects = vec![
                        json!({"id":"chart-1","name":"분기 실적","frame":{"x":55,"y":20,"width":40,"height":35,"rotation":0},"content":{"kind":"chart","chart_type":"column","title":"실적","categories":["A","B"],"series":[{"name":"건수","values":[10,20]}]}}),
                        json!({"id":"shape-1","name":"강조 도형","frame":{"x":55,"y":85,"width":35,"height":5,"rotation":0},"content":{"kind":"shape","shape":"rectangle","fill":"#F58254"}}),
                    ];
                    if let Some(m) = input["available_images"].as_array().and_then(|a| a.first()) {
                        objects.push(json!({"id":"image-1","name":"등록 이미지","frame":{"x":55,"y":60,"width":30,"height":20,"rotation":0},"content":{"kind":"image","media_id":m["id"]}}));
                    }
                    json!(objects)
                }
            }
            _ => Value::Null,
        };
        changes.insert(
            name.into(),
            if input["user_request"] == "title-only-auto" && name != "title" {
                Value::Null
            } else {
                value
            },
        );
    }
    if invalid {
        changes.insert("unexpected".into(), json!("outside scope"));
    }
    json!({"tool":"propose_slide_patch","message":"선택한 내용을 수정했습니다.","changes":changes})
}
