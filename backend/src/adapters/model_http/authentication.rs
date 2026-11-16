// Purpose: Construct sensitive Bearer headers for protocols that explicitly select them.
// Pattern: Shared header mechanics; required-key policy belongs to inference/catalog.
// Usage: Native adapters opt into Bearer; Gemini supplies its own header contract.
// Related: transport.rs, claude.rs, gemini.rs.
use super::Transport;
use crate::modules::{model_execution::Error, model_registry::Credentials};
use reqwest::{
    RequestBuilder,
    header::{AUTHORIZATION, HeaderValue},
};
use secrecy::ExposeSecret;
pub(crate) fn bearer(
    t: &Transport,
    c: &Credentials,
    path: &str,
    post: bool,
) -> Result<RequestBuilder, Error> {
    let request = t.request(&c.base_url, c.timeout_seconds, path, post);
    if let Some(token) = &c.token {
        let mut value = HeaderValue::from_str(&format!("Bearer {}", token.expose_secret()))
            .map_err(|_| Error::Authentication)?;
        value.set_sensitive(true);
        Ok(request.header(AUTHORIZATION, value))
    } else {
        Ok(request)
    }
}
