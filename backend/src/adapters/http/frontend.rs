// Purpose: Serve embedded release assets or the development-server hint.
// Pattern: HTTP-only static asset adapter with explicit missing-asset handling.
// Usage: Mounted under /home by the HTTP router.
// Related: http/mod.rs, frontend/vite.config.ts.
use axum::response::{IntoResponse, Response};

#[cfg(feature = "embedded-ui")]
#[derive(rust_embed::RustEmbed)]
#[folder = "../frontend/dist/"]
struct FrontendAssets;

#[cfg(feature = "embedded-ui")]
pub async fn serve(uri: axum::http::Uri) -> Response {
    use axum::http::{StatusCode, header};

    let path = uri
        .path()
        .strip_prefix("/home")
        .unwrap_or("")
        .trim_start_matches('/');
    let asset = FrontendAssets::get(path)
        .map(|file| (path, file))
        .or_else(|| {
            if path.starts_with("assets/")
                || path.rsplit('/').next().is_some_and(|p| p.contains('.'))
            {
                return None;
            }
            FrontendAssets::get("index.html").map(|file| ("index.html", file))
        });

    match asset {
        Some((name, file)) => {
            let content_type = mime_guess::from_path(name).first_or_octet_stream();
            (
                [
                    (header::CONTENT_TYPE, content_type.as_ref()),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                file.data.into_owned(),
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(not(feature = "embedded-ui"))]
pub async fn serve() -> Response {
    (
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "Frontend is served by Vite during development. Run pnpm dev and open http://localhost:5173/home. Build with scripts/build.sh for the embedded UI.",
    ).into_response()
}
