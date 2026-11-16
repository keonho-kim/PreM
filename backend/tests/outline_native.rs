// Purpose: Verify outline JSON validation on native chat APIs without a structured-output option.
// Pattern: Native LM Studio wire fixture only; no fallback to another provider or protocol.
// Usage: cargo nextest run --test outline_native.
// Related: inference/execution.rs, adapters/llm/lm_studio.rs, outline_support/.
mod common;
#[allow(dead_code)]
mod outline_support;
#[allow(dead_code)]
mod space_support;
use axum::{Json, Router, routing::post};
use outline_support::*;
use puputyx_backend::app::Application;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use uuid::Uuid;
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_chat_uses_prompt_json_and_server_validation_without_protocol_fallback() {
    let invalid = Arc::new(AtomicBool::new(false));
    let flag = invalid.clone();
    let router=Router::new().route("/api/v1/chat",post(move|Json(body):Json<Value>|{let invalid=flag.clone();async move{
  assert_eq!(body["store"],false);assert_eq!(body["integrations"],json!([]));assert!(body.get("response_format").is_none());assert!(body["system_prompt"].as_str().unwrap().contains("JSON"));
  let context:Value=serde_json::from_str(body["input"].as_str().unwrap()).unwrap();
  let text=if invalid.load(Ordering::SeqCst){"not JSON".into()}else{json!({"nodes":[{"key":"one","parent_key":"","title":"발표 개요","description":"","block_keys":[context["source_excerpts"][0]["key"]]}]}).to_string()};
  Json(json!({"output":[{"type":"reasoning","content":"not user-visible"},{"type":"message","content":text}],"stats":{"input_tokens":100,"total_output_tokens":50}}))
 }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/api/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let root = common::storage();
    let mut app = Application::open(root.path()).unwrap();
    app.start_processing();
    let f = Fixture::start().await;
    let (p, _, _) = setup(&app, &f).await;
    let id = Uuid::new_v4().to_string();
    let(s,r)=common::request(&crate::common::router(&app),"PUT",&format!("/api/v1/admin/llm/providers/{id}"),Some(json!({"expected_version":0,"name":"Native","provider_type":"lm_studio_native","base_url":base,"model_identifier":"native-fixture","timeout_seconds":5,"enabled":true})),None).await;
    assert_eq!(s, 200, "{r}");
    create(&app, &p, &id, "generate").await;
    let result = wait(&app, &p, "succeeded").await;
    assert_eq!(result["draft"]["nodes"][0]["title"], "발표 개요");
    assert!(!result.to_string().contains("not user-visible"));
    assert_eq!(f.model.calls.load(Ordering::SeqCst), 0);
    invalid.store(true, Ordering::SeqCst);
    create(&app, &p, &id, "generate").await;
    assert_eq!(wait(&app, &p, "failed").await["version"], 1);
    app.shutdown().await.unwrap();
    server.abort();
    let _ = server.await;
}
