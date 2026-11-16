// Purpose: Verify vLLM-SR inventory variants, credentials, bounded fallback and failure isolation.
// Pattern: Real app/HTTP against synthetic router and standalone runtime endpoints.
// Usage: cargo nextest run --test vllm_sr; no real provider key or document leaves the machine.
// Related: adapters/decisions/vllm_sr.rs, decisions.rs, provider_migration.rs.
mod common;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use common::request;
use puputyx_backend::app::Application;
use serde_json::json;
use std::sync::{Arc, Mutex};
type Calls = Arc<Mutex<Vec<(String, String)>>>;

async fn inventory(
    State(calls): State<Calls>,
    Path((mode, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    calls.lock().unwrap().push((mode.clone(), path.clone()));
    if mode == "hosted" {
        assert_eq!(headers["authorization"], "Bearer synthetic-key");
    } else {
        assert!(!headers.contains_key("authorization"));
    }
    if path == "systemone/models" {
        match mode.as_str() {
            "runtime" | "mixed" => return StatusCode::NOT_FOUND.into_response(),
            "method" => return StatusCode::METHOD_NOT_ALLOWED.into_response(),
            "auth" => return (StatusCode::UNAUTHORIZED, "private detail").into_response(),
            "busy" => return (StatusCode::TOO_MANY_REQUESTS, "private detail").into_response(),
            "down" => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            "bad" => return Json(json!({"data":"invalid"})).into_response(),
            "large" => return Json(json!({"data":vec![json!({"id":"x"});1001]})).into_response(),
            "bad-id" => return Json(json!({"data":[{"id":"bad\nname"}]})).into_response(),
            "bad-types" => {
                return Json(json!({"data":[{"id":"x","question_types":[1]}]})).into_response();
            }
            _ => (),
        }
    } else {
        assert_eq!(path, "models");
        assert!(["runtime", "mixed", "method"].contains(&mode.as_str()));
    }
    Json(match mode.as_str() {
        "runtime" | "method" => json!({"models":[
            {"name":"vllm-sr/vela3-fast","description":"Local","release_date":"2026-11-01"},
            {"name":"no-choice","features":["span"]}
        ],"data":[{"id":"chat","system":"two"}]}),
        "mixed" => json!({"data":[
            {"id":"vllm-sr/vela3-fast","card":{"question_types":["choice"]}},
            {"id":"chat"}, {"id":"routed","system":"two","question_types":["choice"]}
        ]}),
        _ => json!({"data":[
            {"id":"vllm-sr/d3-flash","question_types":["choice","noul"]},
            {"id":"vllm-sr/d3-flash","question_types":["choice"]},
            {"id":"span-only","question_types":["span"]},
            {"id":"vllm-sr/auto","routing":true},
            {"id":"vllm-sr/norn-1","system":"two"}
        ]}),
    })
    .into_response()
}

#[tokio::test]
async fn inventory_is_native_filtered_and_only_missing_routes_use_runtime_discovery() {
    let calls: Calls = Arc::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let upstream = Router::new()
        .route("/{mode}/v1/{*path}", get(inventory))
        .with_state(calls.clone());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let root = common::storage();
    let app = Application::open(root.path()).unwrap();
    for mode in [
        "hosted",
        "runtime",
        "mixed",
        "method",
        "auth",
        "busy",
        "down",
        "bad",
        "large",
        "bad-id",
        "bad-types",
    ] {
        let mut body =
            json!({"provider_type":"vllm_sr_decision","base_url":format!("{base}/{mode}/v1")});
        if mode == "hosted" {
            body["api_key"] = json!("synthetic-key");
        }
        let before = calls.lock().unwrap().len();
        let (status, result) = request(
            &crate::common::router(&app),
            "POST",
            "/api/v1/admin/llm/models/discover",
            Some(body),
            None,
        )
        .await;
        let runtime = ["runtime", "mixed", "method"].contains(&mode);
        if runtime || mode == "hosted" {
            assert_eq!(status, 200, "{mode}: {result}");
            assert_eq!(
                result,
                json!([if runtime {
                    "vllm-sr/vela3-fast"
                } else {
                    "vllm-sr/d3-flash"
                }])
            );
        } else {
            assert_eq!(status, 502, "{mode}: {result}");
            assert!(!result.to_string().contains("private detail"));
        }
        assert_eq!(
            calls.lock().unwrap().len() - before,
            if runtime { 2 } else { 1 }
        );
    }
    let db = rusqlite::Connection::open(root.path().join("db/app.sqlite")).unwrap();
    for table in ["llm_provider_connections", "llm_requests"] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    drop(db);
    app.shutdown().await.unwrap();
    server.abort();
    let _ = server.await;
}
