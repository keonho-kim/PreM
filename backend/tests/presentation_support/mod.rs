// Purpose: Prepare confirmed authoring inputs for real presentation integration tests.
// Pattern: Existing public APIs only; all fixtures and models remain local and disposable.
// Usage: Presentation lifecycle and native template tests.
// Related: outline_support/, presentations.rs, presentation_templates.rs.
pub mod edits;
use crate::{common::request, outline_support::*};
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::time::Duration;
pub async fn preparation(app: &Application, p: &str) -> Value {
    let (s, v) = request(
        &app.router(),
        "GET",
        &format!("/api/v1/projects/{p}/presentation-preparation"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
pub async fn prepared(app: &Application, p: &str, c: &str) -> Value {
    create(app, p, c, "generate").await;
    let outline = wait(app, p, "succeeded").await;
    let (s, v) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/outline/confirm"),
        Some(json!({"expected_version":outline["version"]})),
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    let pre = preparation(app, p).await;
    assert_eq!(pre["ready"], true);
    let (s, review) = request(
        &app.router(),
        "POST",
        &format!("/api/v1/projects/{p}/presentation-preparation/evidence"),
        Some(json!({"fingerprint":pre["fingerprint"]})),
        None,
    )
    .await;
    assert_eq!(s, 200, "{review}");
    let(s,design)=request(&app.router(),"PUT",&format!("/api/v1/projects/{p}/presentation-preparation/design"),Some(json!({"expected_version":review["version"],"evidence_review_id":review["evidence_review_id"],"template_job_id":null})),None).await;
    assert_eq!(s, 200, "{design}");
    design
}
pub async fn wait_run(app: &Application, p: &str, status: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(90), async {
        loop {
            let (_, runs) = request(
                &app.router(),
                "GET",
                &format!("/api/v1/projects/{p}/presentations"),
                None,
                None,
            )
            .await;
            let r = &runs[0];
            if r["status"] == status {
                return r.clone();
            }
            assert!(r["status"] != "failed" || status == "failed", "{r}");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap()
}
pub fn input(design: &Value, c: &str) -> Value {
    json!({"design_id":design["design_id"],"title":"업무 현황과 실행 계획","instructions":"간결하게 작성","connection_id":c,"model_version":1,"presentation_id":null,"expected_version":0})
}
