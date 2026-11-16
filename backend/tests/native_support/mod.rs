// Purpose: Provide deterministic native-provider protocol fixtures and captured HTTP contracts.
// Pattern: Real loopback server with synthetic credentials and no external model calls.
// Usage: native_providers integration tests inspect paths, headers and serialized bodies.
// Related: native_providers.rs, adapters/llm/.
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::get,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
#[derive(Clone)]
pub struct Seen {
    pub kind: String,
    pub path: String,
    pub headers: HeaderMap,
    pub body: Value,
}
pub struct Fixture {
    pub base: String,
    pub seen: Arc<Mutex<Vec<Seen>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let router = Router::new()
            .route("/{kind}/{*path}", get(list).post(generate))
            .with_state(seen.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self { base, seen, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn list(
    State(seen): State<Arc<Mutex<Vec<Seen>>>>,
    Path((kind, path)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    seen.lock().unwrap().push(Seen {
        kind: kind.clone(),
        path: path.clone(),
        headers,
        body: json!(query),
    });
    Json(match kind.as_str() {
        "claude" => {
            if query.contains_key("after_id") {
                json!({"data":[{"id":"second-model"}],"has_more":false})
            } else {
                json!({"data":[{"id":"model-test"}],"has_more":true,"last_id":"model-test"})
            }
        }
        "gemini" | "gemini_decision" => {
            if query.contains_key("pageToken") {
                json!({"models":[{"name":"models/second-model","supportedGenerationMethods":["generateContent"]}]})
            } else {
                json!({"models":[{"name":"models/model-test","supportedGenerationMethods":["generateContent"]},{"name":"models/embedding-only","supportedGenerationMethods":["embedContent"]}],"nextPageToken":"next"})
            }
        }
        "lm_studio_native" | "lm_studio" | "lm_studio_decision" => {
            json!({"models":[{"type":"llm","key":"model-test"},{"type":"decision","key":"download-key","loaded_instances":[{"id":"decision-instance"}]},{"type":"embedding","key":"not-chat"}]})
        }
        "sglang" => json!({"model_path":"model-test","is_generation":true}),
        _ => json!({"data":[{"id":"model-test"}]}),
    })
}
async fn generate(
    State(seen): State<Arc<Mutex<Vec<Seen>>>>,
    Path((kind, path)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    seen.lock().unwrap().push(Seen {
        kind: kind.clone(),
        path: path.clone(),
        headers,
        body: body.clone(),
    });
    if path == "apply-template" {
        return Json(json!({"prompt":"server-rendered-template"}));
    }
    if path == "tokenize" {
        return Json(json!({"tokens":[17,42],"count":2}));
    }
    let schema = body
        .pointer("/text/format/schema")
        .or(body.pointer("/output_config/format/schema"))
        .or(body.pointer("/generationConfig/responseJsonSchema"))
        .or(body.get("json_schema"))
        .or(body.pointer("/sampling_params/json_schema"))
        .or(body.pointer("/response_format/json_schema/schema"));
    let content = if schema.is_some() {
        "{\"status\":\"ok\"}"
    } else {
        "PuPuTyX connection OK"
    };
    let failure = path.starts_with("bad/");
    Json(match kind.as_str() {
        "openai" => {
            json!({"status":if failure{"incomplete"}else{"completed"},"output":[{"type":"reasoning","summary":[{"text":"PRIVATE_REASONING"}]},{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":content}]}],"usage":{"input_tokens":10,"output_tokens":5}})
        }
        "claude" => {
            json!({"type":"message","role":"assistant","stop_reason":if failure{"max_tokens"}else{"end_turn"},"content":[{"type":"thinking","thinking":"PRIVATE_REASONING"},{"type":"text","text":content}],"usage":{"input_tokens":10,"output_tokens":5}})
        }
        "gemini" => {
            json!({"candidates":[{"finishReason":if failure{"SAFETY"}else{"STOP"},"content":{"parts":[{"thought":true,"text":"PRIVATE_REASONING"},{"text":content}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}})
        }
        "lm_studio_native" => {
            json!({"output":[{"type":"reasoning","content":"PRIVATE_REASONING"},{"type":if failure{"tool_call"}else{"message"},"content":content}],"stats":{"input_tokens":10,"total_output_tokens":5}})
        }
        "llama_cpp" => {
            json!({"content":content,"stop_type":"eos","truncated":false,"tokens_evaluated":10,"tokens_predicted":5})
        }
        "sglang" => {
            json!({"text":content,"meta_info":{"finish_reason":{"type":"stop"},"prompt_tokens":10,"completion_tokens":5}})
        }
        _ => {
            json!({"choices":[{"finish_reason":"stop","message":{"content":content}}],"usage":{"prompt_tokens":10,"completion_tokens":5}})
        }
    })
}
