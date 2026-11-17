// Purpose: Hold real model requests until tests release them, for both LLM and System One.
// Pattern: Local HTTP fixture with exact start counts and explicit cancellation on drop.
// Usage: model_capacity.rs; never invokes installed models or production storage.
// Related: common/mod.rs, modules/model_execution/admission.rs.
use axum::{Json, Router, extract::State, routing::post};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::Semaphore;
#[derive(Clone)]
pub struct Model {
    pub calls: Arc<AtomicUsize>,
    pub release: Arc<Semaphore>,
    pub models: Arc<Mutex<Vec<String>>>,
}
pub struct Fixture {
    pub base: String,
    pub model: Model,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let model = Model {
            calls: Arc::new(AtomicUsize::new(0)),
            release: Arc::new(Semaphore::new(0)),
            models: Arc::new(Mutex::new(vec![])),
        };
        let router = Router::new()
            .route("/v1/chat/completions", post(chat))
            .route("/v1/systemone", post(decide))
            .with_state(model.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { base, model, task }
    }
    pub async fn started(&self, n: usize) {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while self.model.calls.load(Ordering::SeqCst) < n {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("fixture request started");
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn hold(model: &Model, body: &Value) {
    model
        .models
        .lock()
        .unwrap()
        .push(body["model"].as_str().unwrap().into());
    model.calls.fetch_add(1, Ordering::SeqCst);
    model.release.acquire().await.unwrap().forget();
}
async fn chat(State(model): State<Model>, Json(body): Json<Value>) -> Json<Value> {
    hold(&model, &body).await;
    Json(json!({"choices":[{"finish_reason":"stop","message":{"content":"PreM connection OK"}}]}))
}
async fn decide(State(model): State<Model>, Json(body): Json<Value>) -> Json<Value> {
    hold(&model, &body).await;
    Json(
        json!({"model":body["model"],"answers":{"toc":{"type":"choice","choice":"1","probabilities":{"0":0.1,"1":0.9},"confidence":0.8}},"usage":{"input_tokens":10,"output_tokens":0}}),
    )
}
pub fn settings(base: &str, kind: &str, version: i64, model: &str) -> Value {
    json!({"expected_version":version,"name":"Capacity fixture","provider_type":kind,"base_url":base,"model_identifier":model,"timeout_seconds":10,"enabled":true})
}
