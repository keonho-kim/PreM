// Purpose: Provide a bounded native decision fixture and real project-source setup for search tests.
// Pattern: Synthetic HTTP model with concurrency/failure controls; no production model or data access.
// Usage: related_documents.rs and related_recovery.rs.
// Related: modules/relations/, document_support/, common/.
use axum::{Json, Router, extract::State, routing::post};
use prem_backend::app::Application;
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tower::ServiceExt;
use uuid::Uuid;
#[derive(Default)]
pub struct Model {
    pub calls: AtomicUsize,
    pub planner_calls: AtomicUsize,
    pub invalid_planner: AtomicBool,
    pub peer_calls: AtomicUsize,
    pub active: AtomicUsize,
    pub peak: AtomicUsize,
    pub fail_once: AtomicBool,
    pub hold: AtomicBool,
    pub release: tokio::sync::Notify,
    pub sizes: Mutex<Vec<usize>>,
    pub model_ids: Mutex<Vec<String>>,
    pub question_counts: Mutex<Vec<usize>>,
}
pub struct Fixture {
    pub base: String,
    pub model: Arc<Model>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let model = Arc::new(Model::default());
        let router = Router::new()
            .route("/v1/systemone", post(evaluate))
            .route("/v1/chat/completions", post(evaluate))
            .with_state(model.clone());
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", l.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(l, router).await.unwrap() });
        Self { base, model, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.model.release.notify_waiters();
        self.task.abort();
    }
}
struct Active(Arc<Model>);
impl Drop for Active {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}
async fn evaluate(State(m): State<Arc<Model>>, Json(v): Json<Value>) -> Json<Value> {
    let native = v.get("state").is_some();
    let payload = if native {
        v.clone()
    } else {
        serde_json::from_str::<Value>(v["messages"][1]["content"].as_str().unwrap()).unwrap()
    };
    if payload["state"].get("regions").is_some() {
        let answers = payload["questions"]
            .as_object()
            .unwrap()
            .keys()
            .map(|id| (id.clone(), if native { json!({"type":"choice","choice":"0","probabilities":{"0":0.9,"1":0.1},"confidence":0.9}) } else { json!({"type":"choice","choice":"0"}) }))
            .collect::<serde_json::Map<_, _>>();
        return Json(if native {
            json!({"model":v["model"],"answers":answers})
        } else {
            json!({"choices":[{"finish_reason":"stop","message":{"content":json!({"answers":answers}).to_string()}}]})
        });
    }
    m.calls.fetch_add(1, Ordering::SeqCst);
    let active = m.active.fetch_add(1, Ordering::SeqCst) + 1;
    m.peak.fetch_max(active, Ordering::SeqCst);
    let _active = Active(m.clone());
    m.sizes
        .lock()
        .unwrap()
        .push(serde_json::to_vec(&v).unwrap().len());
    m.model_ids
        .lock()
        .unwrap()
        .push(v["model"].as_str().unwrap().into());
    let native = v.get("state").is_some();
    let input = if native {
        v.clone()
    } else {
        serde_json::from_str::<Value>(v["messages"][1]["content"].as_str().unwrap()).unwrap()
    };
    if !native && input.get("state").is_none() {
        m.planner_calls.fetch_add(1, Ordering::SeqCst);
        let content = if m.invalid_planner.swap(false, Ordering::SeqCst) {
            json!({"queries":["x".repeat(121)]})
        } else {
            json!({"queries":["BRIDGE_TOKEN"]})
        };
        return Json(
            json!({"choices":[{"finish_reason":"stop","message":{"content":content.to_string()}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}),
        );
    }
    if input["state"]["current"]["workspace_evidence"]
        .as_array()
        .is_some_and(|v| !v.is_empty())
    {
        m.peer_calls.fetch_add(1, Ordering::SeqCst);
    }
    assert!(input["state"]["current"]["documents"].as_array().is_some());
    if native {
        assert_eq!(input["state"]["candidates"].as_object().unwrap().len(), 1);
    }
    m.question_counts
        .lock()
        .unwrap()
        .push(input["questions"].as_object().unwrap().len());
    if m.hold.load(Ordering::SeqCst) {
        m.release.notified().await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    if m.fail_once.swap(false, Ordering::SeqCst) {
        return Json(json!({"answers":{},"model":"fixture"}));
    }
    let mut answers = serde_json::Map::new();
    for (id, _) in input["questions"].as_object().unwrap() {
        let text = input["state"]["candidates"][id]["text"].as_str().unwrap();
        let choice = if text.contains("NEEDS_MORE")
            || (text.contains("NEEDS_CONTEXT") && !text.contains("BASELINE_CONFIRMED"))
        {
            5
        } else if text.contains("CONFLICTING") {
            4
        } else if text.contains("DIVERSE_ONLY") {
            3
        } else if text.contains("UNRELATED") {
            0
        } else {
            2
        };
        let probs = (0..6)
            .map(|k| (k.to_string(), json!(if k == choice { 0.9 } else { 0.02 })))
            .collect::<serde_json::Map<_, _>>();
        answers.insert(id.clone(),if native{json!({"type":"choice","choice":choice.to_string(),"probabilities":probs,"confidence":0.9})}else{json!({"type":"choice","choice":choice.to_string()})});
    }
    if native {
        Json(
            json!({"model":v["model"],"answers":answers,"usage":{"input_tokens":100,"output_tokens":10}}),
        )
    } else {
        Json(
            json!({"choices":[{"finish_reason":"stop","message":{"content":json!({"answers":answers}).to_string()}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}),
        )
    }
}
pub async fn project(app: &Application, name: &str) -> String {
    let (s, v) = super::common::request(
        &crate::common::router(app),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":name,"due_date":"2030-01-01"})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 201, "{v}");
    v["id"].as_str().unwrap().into()
}
pub async fn upload(app: &Application, p: &str, text: &str) -> Value {
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    let html = format!(
        "<!DOCTYPE html><html><head><title>Business</title></head><body><h1>Business report</h1><p>{text}</p></body></html>"
    );
    let body = super::space_support::body("business.html", html.as_bytes(), "업무 보고서", "[]");
    let r = app
        .router()
        .oneshot(
            Request::post(format!("/api/v1/projects/{p}/files"))
                .header(
                    "Content-Type",
                    "multipart/form-data; boundary=space-boundary",
                )
                .header("Idempotency-Key", Uuid::new_v4().to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let b = to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
    let v: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(status, 201, "{v}");
    v
}
pub async fn prepared(app: &Application, p: &str, item: &Value) {
    super::document_support::wait(
        app,
        &format!("project-{p}"),
        item["id"].as_str().unwrap(),
        "succeeded",
    )
    .await;
}
pub async fn register(app: &Application, f: &Fixture) -> String {
    register_kind(app, f, "lm_studio_decision").await
}
pub async fn register_kind(app: &Application, f: &Fixture, kind: &str) -> String {
    let id = Uuid::new_v4().to_string();
    let (s,v)=super::common::request(&crate::common::router(app),"PUT",&format!("/api/v1/admin/llm/providers/{id}"),Some(json!({"expected_version":0,"name":"자료 비교","provider_type":kind,"base_url":f.base,"model_identifier":"fixture","timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200, "{v}");
    let (s, v) = super::common::request(
        &crate::common::router(app),
        "PUT",
        "/api/v1/admin/related-search/settings",
        Some(json!({"expected_version":0,"connection_id":id})),
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    id
}
pub async fn start(app: &Application, p: &str, query: &str) -> Value {
    let (s, v) = super::common::request(
        &crate::common::router(app),
        "POST",
        &format!("/api/v1/projects/{p}/related-searches"),
        Some(json!({"query":query,"options":{"include_archived":true}})),
        Some(&Uuid::new_v4().to_string()),
    )
    .await;
    assert_eq!(s, 202, "{v}");
    v
}
pub async fn wait(app: &Application, p: &str, id: &str, status: &str) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(60), async {
        loop {
            let (s, v) = super::common::request(
                &crate::common::router(app),
                "GET",
                &format!("/api/v1/projects/{p}/related-searches/{id}"),
                None,
                None,
            )
            .await;
            assert_eq!(s, 200, "{v}");
            if v["status"] == status {
                return v;
            }
            assert_ne!(v["status"], "failed", "{v}");
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        }
    })
    .await
    .expect("search timed out")
}
pub async fn results(app: &Application, p: &str, id: &str, kind: &str) -> Value {
    let (s, v) = super::common::request(
        &crate::common::router(app),
        "GET",
        &format!("/api/v1/projects/{p}/related-searches/{id}/results?kind={kind}"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
pub async fn setup(app: &Application, n: usize) -> String {
    let target = project(app, "현재 업무").await;
    let item = upload(
        app,
        &target,
        "Current efficiency improvement plan with business goals.",
    )
    .await;
    prepared(app, &target, &item).await;
    let mut pending = Vec::new();
    for i in 0..n {
        let p = project(app, &format!("과거 프로젝트 {i}")).await;
        let item = upload(
            app,
            &p,
            &format!("efficiency SUPPORT evidence for workflow optimization number {i}"),
        )
        .await;
        pending.push((p, item));
    }
    for (p, item) in pending {
        prepared(app, &p, &item).await;
    }
    target
}
