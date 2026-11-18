// Purpose: Serve deterministic System-One-like LLM choices and helpers for document integration tests.
// Pattern: Real local HTTP plus synthetic files; no production model or data mutations.
// Usage: document_processing integration suite.
// Related: ../document_processing.rs, ../space_support/, tests/fixtures/documents/.
use axum::{Json, Router, extract::State, routing::post};
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::sync::Notify;
use uuid::Uuid;
#[derive(Default)]
pub struct Model {
    pub calls: AtomicUsize,
    pub pause_at: AtomicUsize,
    pub models: std::sync::Mutex<Vec<String>>,
    pub hold: AtomicBool,
    pub entered: Notify,
    pub release: Notify,
    pub invalid: AtomicBool,
}
pub struct Fixture {
    pub base: String,
    pub model: Arc<Model>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let model = Arc::new(Model::default());
        let app = Router::new()
            .route("/v1/chat/completions", post(complete))
            .with_state(model.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { base, model, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.model.release.notify_waiters();
        self.task.abort();
    }
}
async fn complete(State(m): State<Arc<Model>>, Json(input): Json<Value>) -> Json<Value> {
    let call = m.calls.fetch_add(1, Ordering::SeqCst) + 1;
    m.models
        .lock()
        .unwrap()
        .push(input["model"].as_str().unwrap().into());
    m.entered.notify_one();
    if m.hold.load(Ordering::SeqCst) || m.pause_at.load(Ordering::SeqCst) == call {
        m.release.notified().await;
    }
    let prompt: Value =
        serde_json::from_str(input["messages"][1]["content"].as_str().unwrap()).unwrap();
    let mut answers = serde_json::Map::new();
    for (id, _) in prompt["questions"].as_object().unwrap() {
        let state = &prompt["state"];
        let text = state["regions"][id]["text"].as_str().unwrap_or_default();
        let value = if let Some(lines) = state["lines"].as_array() {
            let i = id.trim_start_matches('r').parse::<usize>().unwrap();
            if lines[i].as_str().unwrap().contains("Plan") {
                "1"
            } else {
                "0"
            }
        } else if state["current"].is_array() {
            if state["current"].to_string().contains("delivery process") {
                if id == "section" {
                    prompt["questions"][id]["criteria"]
                        .as_object()
                        .unwrap()
                        .iter()
                        .find(|(_, v)| v.as_str().unwrap().contains("Delivery Plan"))
                        .map_or("0", |(k, _)| k.as_str())
                } else {
                    "1"
                }
            } else {
                "0"
            }
        } else if text.contains("...") || text.contains("Contents") || text.contains("CONTENTS") {
            "1"
        } else {
            "0"
        };
        answers.insert(id.clone(), json!({"type":"choice","choice":value}));
    }
    let text = if m.invalid.load(Ordering::SeqCst) {
        "not JSON".to_owned()
    } else {
        json!({"answers":answers}).to_string()
    };
    Json(
        json!({"choices":[{"finish_reason":"stop","message":{"content":text}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}),
    )
}
pub async fn configure(app: &Application, f: &Fixture) -> Uuid {
    let id = Uuid::new_v4();
    let(s,_)=super::common::request(&crate::common::router(app),"PUT",&format!("/api/v1/admin/llm/providers/{id}"),Some(json!({"expected_version":0,"name":"Document fixture LLM","provider_type":"lm_studio","base_url":f.base,"model_identifier":"fixture","timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200);
    let (s, _) = super::common::request(
        &crate::common::router(app),
        "PUT",
        "/api/v1/admin/document-processing/settings",
        Some(json!({"expected_version":0,"connection_id":id})),
        None,
    )
    .await;
    assert_eq!(s, 200);
    id
}
pub fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/documents")
            .join(name),
    )
    .unwrap()
}
pub async fn upload(app: &Application, kind: &str, name: &str, bytes: &[u8]) -> Value {
    let (s, item) = super::space_support::upload(
        &crate::common::router(app),
        &format!("/api/v1/space/{kind}"),
        &Uuid::new_v4().to_string(),
        None,
        name,
        bytes,
        name,
    )
    .await;
    assert_eq!(s, axum::http::StatusCode::CREATED, "{item}");
    item
}
pub async fn wait(app: &Application, kind: &str, id: &str, status: &str) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(90), async {
        loop {
            let (s, d) = super::common::request(
                &crate::common::router(app),
                "GET",
                &format!("/api/v1/space/{kind}/{id}/processing"),
                None,
                None,
            )
            .await;
            assert_eq!(s, 200, "{d}");
            if d["job"]["status"] == status {
                return d;
            }
            assert_ne!(d["job"]["status"], "failed", "{d}");
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("document stage timed out")
}
