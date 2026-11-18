// Purpose: Seed a checked-draft fixture for suites testing work after provider registration.
// Pattern: Only the integration-test router installs this middleware, never the application router.
// Usage: Offline, failing and delayed model fixtures must be registerable before their scenario runs.
// Related: common/mod.rs, provider_thinking.rs (real HTTP without fixture receipts).
use axum::{
    body::{Body, to_bytes},
    extract::Request,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;
pub(super) async fn with_fixture_receipt(mut req: Request, db: &std::path::Path) -> Request {
    if req.method() != "PUT" || req.headers().contains_key("X-Connection-Diagnostic") {
        return req;
    }
    let Some(id) = req
        .uri()
        .path()
        .strip_prefix("/api/v1/admin/llm/providers/")
        .and_then(|v| Uuid::parse_str(v).ok())
    else {
        return req;
    };
    let bytes = to_bytes(std::mem::take(req.body_mut()), 65536)
        .await
        .unwrap();
    if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        let artifacts = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/.artifacts")
            .canonicalize()
            .unwrap();
        assert!(
            db.canonicalize().unwrap().starts_with(artifacts),
            "fixture setup requires disposable test storage"
        );
        let token = Uuid::new_v4().to_string();
        let hash = hex::encode(Sha256::digest(body.to_string().as_bytes()));
        Connection::open(db)
            .unwrap()
            .execute(
                "INSERT INTO provider_diagnostics VALUES(?,?,?,NULL,unixepoch()+60)",
                params![token, id.to_string(), hash],
            )
            .unwrap();
        req.headers_mut()
            .insert("X-Connection-Diagnostic", token.parse().unwrap());
    }
    *req.body_mut() = Body::from(bytes);
    req
}
