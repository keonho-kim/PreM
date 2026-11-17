// Purpose: Provide a local deterministic OpenAI-compatible server for provider contracts.
// Pattern: Real HTTP and owned task cleanup, never an external model or application storage.
// Usage: Provider integration tests start one fixture and stop it on drop.
// Related: providers.rs, common/mod.rs.
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Notify;
#[derive(Clone, Default)]
struct FixtureState {
    started: Arc<Notify>,
    resume: Arc<Notify>,
}
pub struct Fixture {
    pub base: String,
    task: tokio::task::JoinHandle<()>,
    state: FixtureState,
}
impl Fixture {
    pub async fn start() -> Self {
        let state = FixtureState::default();
        let router = Router::new()
            .route("/{mode}/v1/models", get(models))
            .route("/{mode}/api/v1/models", get(native_models))
            .route("/{mode}/v1/chat/completions", post(chat))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self { base, task, state }
    }
    pub async fn started(&self) {
        self.state.started.notified().await;
    }
    pub fn resume(&self) {
        self.state.resume.notify_one();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn models(Path(mode): Path<String>) -> Response {
    if mode == "redirect" {
        return (
            StatusCode::TEMPORARY_REDIRECT,
            [("Location", "/ok/v1/models")],
        )
            .into_response();
    }
    Json(json!({"data":[{"id":"ornith-1.5-35b-a3b"}]})).into_response()
}
async fn chat(
    State(state): State<FixtureState>,
    Path(mode): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if mode == "auth"
        && headers.get("authorization").and_then(|v| v.to_str().ok()) != Some("Bearer fixture-key")
    {
        return (
            StatusCode::UNAUTHORIZED,
            "do not expose upstream error body",
        )
            .into_response();
    }
    if mode == "wait" {
        state.started.notify_one();
        state.resume.notified().await;
    }
    if mode == "timeout" {
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
    }
    if mode == "oversize" {
        return "x".repeat(600 * 1024).into_response();
    }
    let content = if mode == "invalid" {
        "{\"status\":\"wrong\"}"
    } else if body.get("response_format").is_some() {
        "{\"status\":\"ok\"}"
    } else {
        "PreM connection OK"
    };
    Json(json!({"choices":[{"finish_reason":"stop","message":{"content":content,"reasoning_content":"not part of the user-visible result"}}],"usage":{"prompt_tokens":20,"completion_tokens":8}})).into_response()
}
pub fn settings(base: &str, mode: &str) -> Value {
    json!({"expected_version":0,"name":"LM Studio test","provider_type":"lm_studio","base_url":format!("{base}/{mode}/v1"),"model_identifier":"ornith-1.5-35b-a3b","timeout_seconds":5,"enabled":true})
}

async fn native_models(Path(mode): Path<String>) -> Response {
    if mode == "redirect" {
        return (
            StatusCode::TEMPORARY_REDIRECT,
            [("Location", "/ok/api/v1/models")],
        )
            .into_response();
    }
    Json(json!({"models":[{"type":"llm","key":"ornith-1.5-35b-a3b"}]})).into_response()
}
