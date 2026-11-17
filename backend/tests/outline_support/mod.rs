// Purpose: Provide deterministic outline/model contracts and real project setup for integration tests.
// Pattern: Synthetic source content, loopback inference, isolated app storage and held/failing calls.
// Usage: Outline lifecycle tests; no live model credentials or application data.
// Related: outlines.rs, outline_recovery.rs, common/, space_support/.
mod edit;
use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::post};
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
    pub budgets: std::sync::Mutex<Vec<u64>>,
    pub requests: std::sync::Mutex<Vec<Value>>,
    pub calls: AtomicUsize,
    pub maps: AtomicUsize,
    pub slides: AtomicUsize,
    pub fail_second: AtomicBool,
    pub invalid: AtomicBool,
    pub hold: AtomicBool,
    pub entered: Notify,
    pub release: Notify,
}
pub struct Fixture {
    pub base: String,
    pub model: Arc<Model>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start() -> Self {
        let model = Arc::new(Model::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let router = Router::new()
            .route("/v1/chat/completions", post(complete))
            .with_state(model.clone());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { base, model, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.model.release.notify_waiters();
        self.task.abort();
    }
}
async fn complete(
    State(m): State<Arc<Model>>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    let input: Value =
        serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
    if input["state"].get("regions").is_some() {
        let answers = input["questions"]
            .as_object()
            .unwrap()
            .keys()
            .map(|id| (id.clone(), json!({"type":"choice","choice":"0"})))
            .collect::<serde_json::Map<_, _>>();
        return Json(json!({"choices":[{"finish_reason":"stop","message":{"content":json!({"answers":answers}).to_string()}}]})).into_response();
    }
    m.requests.lock().unwrap().push(input.clone());
    m.budgets
        .lock()
        .unwrap()
        .push(body["max_tokens"].as_u64().unwrap());
    m.calls.fetch_add(1, Ordering::SeqCst);
    m.entered.notify_one();
    if m.hold.load(Ordering::SeqCst) {
        m.release.notified().await;
    }
    let input: Value =
        serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
    if input["task"] == "slide_edit" {
        if input["user_request"] == "batch-failure"
            && input["current_slide"]["title"] == "실행 계획"
            && m.fail_second.load(Ordering::SeqCst)
        {
            return (StatusCode::BAD_GATEWAY, "synthetic edit interruption").into_response();
        }
        let result = edit::response(&input, m.invalid.load(Ordering::SeqCst));
        return Json(json!({"choices":[{"finish_reason":"stop","message":{"content":result.to_string()}}],"usage":{"prompt_tokens":100,"completion_tokens":50}})).into_response();
    }
    if input["task"] == "presentation_slide" {
        let call = m.slides.fetch_add(1, Ordering::SeqCst) + 1;
        if call == 2 && m.fail_second.load(Ordering::SeqCst) {
            return (StatusCode::BAD_GATEWAY, "synthetic interruption").into_response();
        }

        let block = if m.invalid.load(Ordering::SeqCst) {
            json!(Uuid::new_v4())
        } else {
            input["sources"][0]["id"].clone()
        };
        let mut result = json!({"schema_version":1,"title":input["section"]["title"],"bullets":["문서에서 확인한 업무 현황","검토한 원문을 바탕으로 실행 계획을 정리합니다."],"notes":"원문을 확인한 후 발표합니다.","block_ids":[block]});
        if let Some(layout) = input["template"]["layouts"]
            .as_array()
            .and_then(|l| l.first())
        {
            result["schema_version"] = json!(4);
            result["design"] = json!({"layout_key":layout["key"],"authored":false,"objects":[]});
        }
        return Json(json!({"choices":[{"finish_reason":"stop","message":{"content":result.to_string()}}],"usage":{"prompt_tokens":100,"completion_tokens":50}})).into_response();
    }
    let sources = input["source_excerpts"].as_array().unwrap();
    assert!(body["response_format"]["json_schema"].is_object());
    let mut result = if input["task"] == "generate" {
        json!({"nodes":[{"key":"root","parent_key":"","title":"업무 현황","description":"전체 구성","block_keys":[]},{"key":"current","parent_key":"root","title":"현황 요약","description":"원문 현황","block_keys":[sources[0]["key"]]},{"key":"plan","parent_key":"root","title":"실행 계획","description":"후속 계획","block_keys":[sources[1]["key"]]}]})
    } else {
        let call = m.maps.fetch_add(1, Ordering::SeqCst) + 1;
        if call == 2 && m.fail_second.load(Ordering::SeqCst) {
            return (StatusCode::BAD_GATEWAY, "private model failure").into_response();
        }
        let nodes = input["sections"].as_array().unwrap();
        let assignments=sources.iter().enumerate().map(|(i,b)|json!({"block_key":b["key"],"node_keys":if i==0&&nodes.len()>1{vec![nodes[0]["key"].clone(),nodes[1]["key"].clone()]}else{vec![nodes[i%nodes.len()]["key"].clone()]}})).collect::<Vec<_>>();
        json!({"assignments":assignments})
    };
    if m.invalid.load(Ordering::SeqCst) {
        result["nodes"][0]["block_keys"] = json!(["foreign-block"]);
    }
    Json(json!({"choices":[{"finish_reason":"stop","message":{"content":result.to_string()}}],"usage":{"prompt_tokens":100,"completion_tokens":50}})).into_response()
}
pub async fn setup(app: &Application, f: &Fixture) -> (String, String, Value) {
    let key = Uuid::new_v4().to_string();
    let (s, p) = crate::common::request(
        &crate::common::router(app),
        "POST",
        "/api/v1/projects",
        Some(json!({"name":"발표 구성","due_date":"2030-01-01"})),
        Some(&key),
    )
    .await;
    assert_eq!(s, 201, "{p}");
    let p = p["id"].as_str().unwrap().to_owned();
    let source = (0..22)
        .map(|i| format!("업무 내용 {i}: 현황과 개선 계획을 설명합니다.\n\n"))
        .collect::<String>();
    let connection = Uuid::new_v4().to_string();
    let(s,model)=crate::common::request(&crate::common::router(app),"PUT",&format!("/api/v1/admin/llm/providers/{connection}"),Some(json!({"expected_version":0,"name":"작성 AI","provider_type":"openai_compatible","base_url":f.base,"model_identifier":"fixture","timeout_seconds":30,"enabled":true})),None).await;
    assert_eq!(s, 200, "{model}");
    let (_, default) = crate::common::request(
        &crate::common::router(app),
        "GET",
        "/api/v1/admin/document-processing/settings",
        None,
        None,
    )
    .await;
    let (status, settings) = crate::common::request(
        &crate::common::router(app),
        "PUT",
        "/api/v1/admin/document-processing/settings",
        Some(json!({"expected_version":default["version"],"connection_id":connection})),
        None,
    )
    .await;
    assert_eq!(status, 200, "{settings}");
    let uploaded = source_upload(app, &p, &source).await;
    let file = uploaded["id"].as_str().unwrap();
    // Recovery tests stop the worker after setup; classification must be committed first.
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let (status, processing) = crate::common::request(
                &crate::common::router(app),
                "GET",
                &format!("/api/v1/projects/{p}/files/{file}/processing"),
                None,
                None,
            )
            .await;
            assert_eq!(status, 200, "{processing}");
            assert_ne!(processing["job"]["status"], "failed", "{processing}");
            if processing["job"]["status"] == "succeeded" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("source classification did not finish");
    let review = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let (_, r) = crate::common::request(
                &crate::common::router(app),
                "GET",
                &format!("/api/v1/projects/{p}/source-review"),
                None,
                None,
            )
            .await;
            if r["ready"] == true {
                break r;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        crate::common::request(
            &crate::common::router(app),
            "PUT",
            &format!("/api/v1/projects/{p}/source-review"),
            Some(json!({"snapshot":review["snapshot"]})),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(crate::common::request(&crate::common::router(app),"PUT",&format!("/api/v1/projects/{p}/guide"),Some(json!({"expected_version":0,"do_text":"실행 계획을 강조","dont_text":"근거 없는 수치 제외"})),None).await.0,200);
    (p, connection, model)
}
pub async fn source_upload(app: &Application, p: &str, text: &str) -> Value {
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    let response = app
        .router()
        .oneshot(
            Request::post(format!("/api/v1/projects/{p}/files"))
                .header("Idempotency-Key", Uuid::new_v4().to_string())
                .header(
                    "Content-Type",
                    "multipart/form-data; boundary=space-boundary",
                )
                .body(Body::from(crate::space_support::body(
                    "source.md",
                    text.as_bytes(),
                    "원본",
                    "[]",
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let s = response.status();
    let body = to_bytes(response.into_body(), 100000).await.unwrap();
    assert_eq!(s, 201, "{}", String::from_utf8_lossy(&body));
    serde_json::from_slice(&body).unwrap()
}
pub async fn state(app: &Application, p: &str) -> Value {
    let (s, v) = crate::common::request(
        &crate::common::router(app),
        "GET",
        &format!("/api/v1/projects/{p}/outline"),
        None,
        None,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
pub async fn create(app: &Application, p: &str, connection: &str, kind: &str) -> Value {
    let s = state(app, p).await;
    let(status,r)=crate::common::request(&crate::common::router(app),"POST",&format!("/api/v1/projects/{p}/outline/runs"),Some(json!({"expected_version":s["version"],"source_snapshot":s["source_snapshot"],"guide_version":s["guide_version"],"connection_id":connection,"model_version":1,"kind":kind,"node_ids":[]})),Some(&Uuid::new_v4().to_string())).await;
    assert_eq!(status, 202, "{r}");
    r
}
pub async fn wait(app: &Application, p: &str, status: &str) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let s = state(app, p).await;
            if s["run"]["status"] == status {
                return s;
            }
            if status == "succeeded" {
                assert_ne!(s["run"]["status"], "failed", "{s}");
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap()
}
pub fn edit(s: &Value, draft: Value) -> Value {
    json!({"expected_version":s["version"],"source_snapshot":s["source_snapshot"],"guide_version":s["guide_version"],"draft":draft})
}
