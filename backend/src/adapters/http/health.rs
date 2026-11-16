// Purpose: Describe process availability without claiming workflow readiness.
// Pattern: Small transport response using the compiled product version.
// Usage: GET /healthz after application initialization.
// Related: http/mod.rs, app/mod.rs.
use serde::Serialize;

#[derive(Serialize)]
pub struct Health {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
}

impl Default for Health {
    fn default() -> Self {
        Self {
            status: "ok",
            service: "PuPuTyX",
            version: env!("CARGO_PKG_VERSION"),
        }
    }
}
