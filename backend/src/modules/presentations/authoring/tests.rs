// Purpose: Prove model-authored layout choices cannot escape pinned native slots or source scope.
// Pattern: Pure independent layout/response examples; no provider or storage fixtures.
// Usage: Included as template_authoring unit tests.
// Related: authoring/template.rs, authoring/request.rs, object_schema.rs.
use super::*;
fn slot(id: &str, role: &str, x: f64) -> TemplateSlot {
    TemplateSlot {
        id: id.into(),
        role: role.into(),
        max_chars: 120,
        font_size: 24.,
        frame: Frame {
            x,
            y: 10.,
            width: 20.,
            height: 20.,
            rotation: 0.,
        },
    }
}
fn plan() -> Plan {
    Plan {
        layouts: vec![CanvasLayout {
            key: "0:2".into(),
            name: "분석 장표".into(),
            slots: vec![
                slot("slot-0", "title", 5.),
                slot("slot-1", "body", 30.),
                slot("slot-2", "body", 60.),
            ],
            preview_page: None,
        }],
        materials: vec![],
        first: true,
        slide_id: Uuid::new_v4(),
        context: json!({}),
        block_ids: vec![],
    }
}
fn output() -> Value {
    json!({"schema_version":4,"design":{"layout_key":"0:2","authored":false,"objects":[{"slot_id":"slot-2","content":{"kind":"text","text":"추가 설명"}}]},"title":"결론","bullets":["검토한 내용"],"notes":"","block_ids":[]})
}
#[test]
fn slot_content_receives_exact_server_owned_geometry() {
    let plan = plan();
    let spec = decode(&plan, &output().to_string()).unwrap();
    assert_eq!(spec.objects[0].frame, plan.layouts[0].slots[2].frame);
    assert_eq!(spec.objects[0].id, "slot-2");
    validate(&plan, &spec).unwrap();
    let mut forged = output();
    forged["design"]["objects"][0]["frame"] = json!({"x":99});
    assert!(decode(&plan, &forged.to_string()).is_err());
    let mut unknown = output();
    unknown["design"]["layout_key"] = json!("other");
    assert!(decode(&plan, &unknown.to_string()).is_err());
}
#[test]
fn generated_content_cannot_claim_manual_mode_or_overfill_primary_slots() {
    let plan = plan();
    let mut data = output();
    data["design"]["authored"] = json!(true);
    assert!(validate(&plan, &decode(&plan, &data.to_string()).unwrap()).is_err());
    let mut spec = decode(&plan, &output().to_string()).unwrap();
    spec.title = "가".repeat(121);
    assert!(validate(&plan, &spec).is_err());
    let mut data = output();
    data["design"]["objects"][0]["slot_id"] = json!("slot-0");
    assert!(validate(&plan, &decode(&plan, &data.to_string()).unwrap()).is_err());
}
#[test]
fn provider_schema_rejects_reserved_and_other_layout_slots_before_generation_commit() {
    let mut p = plan();
    let mut other = p.layouts[0].clone();
    other.key = "0:3".into();
    other.slots[2].id = "slot-9".into();
    p.layouts.push(other);
    let mut wire = json!({"type":"object","properties":{},"required":[]});
    schema(&p, &mut wire);
    assert!(jsonschema::is_valid(&wire, &output()));
    for id in ["slot-0", "slot-1", "slot-9"] {
        let mut invalid = output();
        invalid["design"]["objects"][0]["slot_id"] = json!(id);
        assert!(!jsonschema::is_valid(&wire, &invalid), "{id}");
    }
    p.layouts[0].slots.pop();
    wire = json!({"type":"object","properties":{},"required":[]});
    schema(&p, &mut wire);
    assert!(!jsonschema::is_valid(&wire, &output()));
    let mut empty = output();
    empty["design"]["objects"] = json!([]);
    assert!(jsonschema::is_valid(&wire, &empty));
}
