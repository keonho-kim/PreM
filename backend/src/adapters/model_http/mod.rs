// Purpose: Own bounded JSON HTTP transport without provider or credential policy.
// Pattern: Shared mechanics without protocol or response-shape assumptions.
// Usage: Native adapters reuse this client; no redirects, proxies or automatic retries.
// Related: authentication.rs, response.rs, provider adapters.
use crate::modules::model_execution::Error;
use reqwest::{Client, RequestBuilder, Response};
use serde_json::Value;
use std::time::Duration;
#[derive(Clone)]
pub(crate) struct Transport(Client);
impl Transport {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self(
            Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(5))
                .build()?,
        ))
    }
    pub fn request(&self, base: &str, seconds: u32, path: &str, post: bool) -> RequestBuilder {
        let url = format!("{base}{path}");
        let request = if post {
            self.0.post(url)
        } else {
            self.0.get(url)
        };
        request
            .timeout(Duration::from_secs(seconds.into()))
            .header("Accept", "application/json")
    }
}
fn transport(e: reqwest::Error) -> Error {
    if e.is_timeout() {
        Error::Timeout
    } else {
        Error::Network
    }
}
pub(crate) async fn read(result: Result<Response, reqwest::Error>) -> Result<Value, Error> {
    let mut response = result.map_err(transport)?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(Error::Authentication);
    }
    if !status.is_success() {
        return Err(Error::Upstream(status.as_u16()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport)? {
        if body.len() + chunk.len() > 512 * 1024 {
            return Err(Error::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
    json::parse(&body).map_err(|_| Error::InvalidResponse)
}

mod authentication;
pub(crate) use authentication::bearer;

mod json;
pub(crate) use json::parse as parse_json;

pub(crate) mod lm_studio_models;
