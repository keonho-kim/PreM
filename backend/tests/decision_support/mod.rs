// Purpose: Serve deterministic native and LLM decision contracts without cloud credentials.
// Pattern: Real local HTTP validates request paths and auth, then emits controlled outcomes.
// Usage: Integration tests; all content and credentials are synthetic.
// Related: ../decisions.rs, adapters/decisions/.
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
pub struct Fixture {
    pub base: String,
    pub calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/{mode}/v1/{*path}", post(evaluate).get(models))
            .route("/{mode}/api/v1/{*path}", axum::routing::get(native_models))
            .with_state(calls.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { base, calls, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn models(Path((mode, path)): Path<(String, String)>) -> Json<Value> {
    assert_eq!(
        path,
        if mode == "vllm_sr" {
            "systemone/models"
        } else {
            "models"
        }
    );
    Json(if mode == "gemini" {
        json!({"models":[{"name":"models/fixture"}]})
    } else {
        json!({"data":[{"id":"fixture"}]})
    })
}
async fn evaluate(
    State(calls): State<Arc<AtomicUsize>>,
    Path((mode, path)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    calls.fetch_add(1, Ordering::SeqCst);
    if mode == "error" {
        return (StatusCode::NOT_FOUND, "upstream private body").into_response();
    }
    if mode == "slow" {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    let gemini = mode == "gemini";
    let openai = mode == "openai";
    let llm = mode == "llm";
    assert_eq!(
        path,
        if openai || gemini {
            "decisions"
        } else if llm {
            "chat/completions"
        } else {
            "systemone"
        }
    );
    if gemini {
        assert_eq!(headers["x-goog-api-key"], "fixture-key");
        assert!(!headers.contains_key("authorization"));
    }
    if openai || mode == "typesafe" || mode == "vllm_sr" {
        assert_eq!(headers["authorization"], "Bearer fixture-key");
    }
    assert_eq!(body["model"], "fixture");
    if openai || gemini {
        assert!(body["input"].is_string());
        assert!(body.get("state").is_none());
    } else if mode == "vllm_sr" {
        let state: Value = serde_json::from_str(body["state"].as_str().unwrap()).unwrap();
        assert_eq!(state["r1"], "Contents");
    } else if !llm {
        assert_eq!(body["state"]["r1"], "Contents");
    }
    let answer = |choice: &str| json!({"type":"choice","choice":choice,"probabilities":{"0":if choice=="0"{0.9}else{0.1},"1":if choice=="1"{0.9}else{0.1}},"confidence":0.8});
    if llm {
        let input: Value =
            serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(input["questions"].as_object().unwrap().len(), 2);
        assert!(
            body.pointer("/response_format/json_schema/schema/properties/answers/properties/toc1")
                .is_some()
        );
        return Json(json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"answers\":{\"toc1\":{\"type\":\"choice\",\"choice\":\"1\"},\"toc2\":{\"type\":\"choice\",\"choice\":\"0\"}}}"}}],"usage":{"prompt_tokens":20,"completion_tokens":10}})).into_response();
    }
    if openai {
        assert_eq!(body["questions"][0]["choices"][0]["value"], "0");
        return Json(json!({"model":"fixture-resolved","answers":[{"name":"toc1","type":"choice","choice":"1","probabilities":[{"value":"0","probability":0.1},{"value":"1","probability":0.9}],"confidence":0.8},{"name":"toc2","type":"choice","choice":"0","probabilities":[{"value":"0","probability":0.9},{"value":"1","probability":0.1}],"confidence":0.8}],"usage":{"input_tokens":20,"output_tokens":2}})).into_response();
    }
    assert_eq!(body["questions"].as_object().unwrap().len(), 2);
    let mut result = json!({"model":"fixture","answers":{"toc1":answer("1"),"toc2":answer("0")},"usage":{"input_tokens":20,"output_tokens":2}});
    match mode.as_str() {
        "missing" => {
            result["answers"].as_object_mut().unwrap().remove("toc2");
        }
        "extra" => {
            result["answers"]["surprise"] = answer("1");
        }
        "sum" => {
            result["answers"]["toc1"]["probabilities"]["1"] = json!(0.2);
        }
        "invalid" => {
            result["answers"]["toc1"]["choice"] = json!("unexpected");
        }
        "refusal" => {
            result["answers"]["toc1"] = json!({"type":"refusal"});
        }
        "duplicate" => {
            return (
                [("Content-Type", "application/json")],
                "{\"answers\":{},\"answers\":{}}",
            )
                .into_response();
        }
        "gemini" => {
            result.as_object_mut().unwrap().remove("model");
            result["usage"] = json!({"total_input_tokens":20,"total_output_tokens":2});
        }
        _ => (),
    }
    Json(result).into_response()
}

async fn native_models(Path((_mode, path)): Path<(String, String)>) -> Json<Value> {
    assert_eq!(path, "models");
    Json(
        json!({"models":[{"type":"decision","key":"fixture","loaded_instances":[{"id":"fixture"}]},{"type":"llm","key":"not-decision"}]}),
    )
}
