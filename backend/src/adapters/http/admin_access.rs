// Purpose: Protect all Admin APIs with one process-lifetime cryptographically random CLI token.
// Pattern: Memory-only verifier, constant-time comparison and bounded failed-attempt throttling.
// Usage: App creates/prints the token once; the outer HTTP boundary protects every Admin route.
// Related: app/mod.rs, frontend/features/admin-access/, tests/admin_access.rs.
use axum::{
    Json,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use secrecy::{ExposeSecret, SecretString};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
#[derive(Clone)]
pub(crate) struct AdminAccess(Arc<Access>);
struct Access {
    token: SecretString,
    current: Mutex<Credential>,
    failures: Mutex<(Instant, u32)>,
}
struct Credential {
    verifier: [u8; 32],
    version: u64,
}
impl AdminAccess {
    pub fn new() -> anyhow::Result<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)?;
        let token = hex::encode(bytes);
        let verifier = Sha256::digest(token.as_bytes()).into();
        Ok(Self(Arc::new(Access {
            token: token.into(),
            current: Mutex::new(Credential {
                verifier,
                version: 1,
            }),
            failures: Mutex::new((Instant::now(), 0)),
        })))
    }
    pub fn cli_token(&self) -> &str {
        self.0.token.expose_secret()
    }
    fn accepts(&self, token: &str) -> bool {
        if !(12..=128).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_graphic()) {
            return false;
        }
        let value: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        self.0
            .current
            .lock()
            .is_ok_and(|c| bool::from(c.verifier.ct_eq(&value)))
    }
    fn failure_status(&self) -> StatusCode {
        let Ok(mut window) = self.0.failures.lock() else {
            return StatusCode::TOO_MANY_REQUESTS;
        };
        if window.0.elapsed() >= Duration::from_secs(30) {
            *window = (Instant::now(), 0)
        }
        window.1 = window.1.saturating_add(1);
        if window.1 > 30 {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::UNAUTHORIZED
        }
    }
}
pub(super) async fn guard(
    State(access): State<AdminAccess>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path != "/api/v1/admin" && !path.starts_with("/api/v1/admin/") {
        return next.run(request).await;
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if token.is_some_and(|t| access.accepts(t)) {
        return next.run(request).await;
    }
    let status = if token.is_some() {
        access.failure_status()
    } else {
        StatusCode::UNAUTHORIZED
    };
    let message = if status == StatusCode::TOO_MANY_REQUESTS {
        "입력을 여러 번 확인하지 못했습니다. 30초 후 다시 시도해 주세요."
    } else {
        "Admin 접근 토큰을 확인해 주세요. 서버를 재시작했다면 새 토큰을 입력하세요."
    };
    let mut response = (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"code":"admin_access_required","message":message})),
    )
        .into_response();
    if status == StatusCode::TOO_MANY_REQUESTS {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, "30".parse().unwrap());
    }
    response
}
pub(super) async fn verify() -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"authenticated":true})),
    )
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    expected_version: u64,
    token: String,
}
fn settings_response(status: StatusCode, value: serde_json::Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
pub(super) fn settings_router(access: AdminAccess) -> axum::Router {
    axum::Router::new()
        .route(
            "/api/v1/admin/general",
            axum::routing::get(settings).put(change),
        )
        .layer(axum::extract::DefaultBodyLimit::max(1024))
        .with_state(access)
}
async fn settings(State(access): State<AdminAccess>) -> Response {
    match access.0.current.lock() {
        Ok(c) => settings_response(StatusCode::OK, serde_json::json!({"version":c.version})),
        Err(_) => settings_response(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({"code":"admin_settings_unavailable","message":"Admin 설정을 읽을 수 없습니다."}),
        ),
    }
}
async fn change(
    State(access): State<AdminAccess>,
    body: Result<Json<Change>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(input)) = body else {
        return settings_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::json!({"code":"invalid_admin_token","message":"새 토큰을 확인해 주세요."}),
        );
    };
    let token: SecretString = input.token.into();
    let text = token.expose_secret();
    if !(12..=128).contains(&text.len()) || !text.bytes().all(|b| b.is_ascii_graphic()) {
        return settings_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::json!({"code":"invalid_admin_token","message":"새 토큰은 공백 없이 영문·숫자·기호 12~128자로 입력하세요."}),
        );
    }
    let value: [u8; 32] = Sha256::digest(text.as_bytes()).into();
    let Ok(mut current) = access.0.current.lock() else {
        return settings_response(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({"code":"admin_settings_unavailable","message":"Admin 설정을 변경할 수 없습니다."}),
        );
    };
    if current.version != input.expected_version {
        return settings_response(
            StatusCode::CONFLICT,
            serde_json::json!({"code":"admin_settings_conflict","message":"Admin 설정이 변경되었습니다. 최신 설정을 확인하고 다시 시도하세요."}),
        );
    }
    if bool::from(current.verifier.ct_eq(&value)) {
        return settings_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::json!({"code":"invalid_admin_token","message":"기존 토큰과 다른 새 토큰을 입력하세요."}),
        );
    }
    current.verifier = value;
    current.version += 1;
    if let Ok(mut failures) = access.0.failures.lock() {
        *failures = (Instant::now(), 0);
    }
    settings_response(
        StatusCode::OK,
        serde_json::json!({"version":current.version}),
    )
}
