// Purpose: Verify real draft probes, immutable thinking settings and server-enforced save receipts.
// Pattern: Raw authenticated application router and a local model that supports on/off but rejects xhigh.
// Usage: cargo test --test provider_thinking. No fixture receipts or external credentials.
// Related: provider_drafts.rs, llm/thinking.rs, decisions/llm.rs.
mod common;
use axum::{
    Json, Router,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

async fn sample(Json(v): Json<Value>, calls: Arc<Mutex<Vec<Value>>>) -> Response {
    calls.lock().unwrap().push(v.clone());
    if v.get("response_format").is_some() {
        return Json(json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"answers\":{\"category\":{\"type\":\"choice\",\"choice\":\"1\"}}}"}}]})).into_response();
    }
    if v["model"] == "unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if v["model"] == "levels-only" && v.get("reasoning_effort").is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if v["model"] != "ignores-effort"
        && v["reasoning_effort"]
            .as_str()
            .is_some_and(|s| s != "low" && s != "medium")
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    Json(json!({"choices":[{"finish_reason":"stop","message":{"content":"PreM connection OK"}}]}))
        .into_response()
}
#[tokio::test]
async fn exact_draft_required_and_decision_overrides_writing_thinking() {
    let root = common::storage();
    let app = prem_backend::app::Application::open(root.path()).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let addr = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", addr.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            addr,
            Router::new().route(
                "/v1/chat/completions",
                post(move |body| sample(body, seen.clone())),
            ),
        )
        .await
        .unwrap()
    });
    let token = HeaderValue::from_str(&format!("Bearer {}", app.admin_token())).unwrap();
    let router = app.router().layer(axum::middleware::from_fn(
        move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            req.headers_mut().insert("authorization", token.clone());
            async move { next.run(req).await }
        },
    ));
    let id = Uuid::new_v4();
    let path = format!("/api/v1/admin/llm/providers/{id}");
    let make_draft = |ver: i64, effort: &str| json!({"expected_version":ver,"name":"Probe","provider_type":"vllm","base_url":url,"model_identifier":"fixture","timeout_seconds":5,"enabled":true,"thinking":true,"thinking_effort":effort});
    let draft = make_draft(0, "xhigh");
    let (s, _) = common::request(&router, "PUT", &path, Some(draft.clone()), None).await;
    assert_eq!(s, 400);
    let diagnose = format!("{path}/diagnose");
    for (model, choice, expected, unverified) in [
        ("levels-only", Value::Null, json!("medium"), false),
        ("ignores-effort", json!("high"), Value::Null, true),
    ] {
        let mut body = make_draft(0, "low");
        body["model_identifier"] = json!(model);
        body["thinking_effort"] = choice;
        let (status, report) = common::request(&router, "POST", &diagnose, Some(body), None).await;
        assert_eq!(status, 200, "{report}");
        assert!(report["ticket"].is_string());
        assert_eq!(report["effective_effort"], expected);
        assert_eq!(report["effort_unverified"], unverified);
    }
    let mut unavailable = make_draft(0, "low");
    unavailable["model_identifier"] = json!("unavailable");
    let (status, report) =
        common::request(&router, "POST", &diagnose, Some(unavailable), None).await;
    assert!(!status.is_success());
    assert!(report.get("ticket").is_none());
    let (s, result) = common::request(&router, "POST", &diagnose, Some(draft.clone()), None).await;
    assert_eq!(s, 200, "{result}");
    assert_eq!(result["accepted_efforts"], json!(["low", "medium"]));
    assert!(result["effective_effort"].is_null());
    let with_ticket = |result: &Value| {
        let token = HeaderValue::from_str(result["ticket"].as_str().unwrap()).unwrap();
        router.clone().layer(axum::middleware::from_fn(
            move |mut req: axum::extract::Request, next: axum::middleware::Next| {
                req.headers_mut()
                    .insert("x-connection-diagnostic", token.clone());
                async move { next.run(req).await }
            },
        ))
    };
    let (s, _) = common::request(
        &with_ticket(&result),
        "PUT",
        &path,
        Some(make_draft(0, "low")),
        None,
    )
    .await;
    assert_eq!(s, 400);
    let (s, saved) = common::request(&with_ticket(&result), "PUT", &path, Some(draft), None).await;
    assert_eq!(s, 200, "{saved}");
    assert_eq!(saved["thinking"], true);
    assert!(saved["thinking_effort"].is_null());
    let draft = make_draft(1, "low");
    let (_, receipt) = common::request(&router, "POST", &diagnose, Some(draft.clone()), None).await;
    let (s, saved) = common::request(&with_ticket(&receipt), "PUT", &path, Some(draft), None).await;
    assert_eq!(s, 200, "{saved}");
    assert_eq!(saved["thinking_effort"], "low");
    let (s, _) = common::request(
        &router,
        "POST",
        &format!("{path}/test"),
        Some(json!({"expected_version":2,"kind":"text"})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(
        calls.lock().unwrap().last().unwrap()["reasoning_effort"],
        "low"
    );
    let(s,result)=common::request(&router,"POST",&format!("/api/v1/admin/decisions/{id}/evaluate"),Some(json!({"expected_version":2,"batch":{"state":"목차","questions":{"category":{"type":"choice","instructions":"분류","criteria":{"0":"본문","1":"목차"}}}}})),None).await;
    assert_eq!(s, 200, "{result}");
    let wire = calls.lock().unwrap().last().unwrap().clone();
    assert_eq!(wire["chat_template_kwargs"]["enable_thinking"], false);
    assert!(wire.get("reasoning_effort").is_none());
    let mut off = make_draft(2, "low");
    off["thinking"] = json!(false);
    off["thinking_effort"] = Value::Null;
    let (_, receipt) = common::request(&router, "POST", &diagnose, Some(off.clone()), None).await;
    let (s, saved) = common::request(&with_ticket(&receipt), "PUT", &path, Some(off), None).await;
    assert_eq!(s, 200, "{saved}");
    assert_eq!(saved["thinking"], false);
    assert!(saved["thinking_effort"].is_null());
    app.shutdown().await.unwrap();
    server.abort();
}
