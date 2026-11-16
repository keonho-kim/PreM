// Purpose: Stream one multipart file, own cancellation and return a durable registration outcome.
// Pattern: A request key survives retries; server cancellation wins or reports prior completion.
// Usage: Uppy XHR sends one file per request to create or append an immutable file version.
// Related: mod.rs, modules/assets/, modules/libraries/, sqlite/libraries/uploads.rs.
use super::*;
use axum::{
    extract::{Multipart, multipart::MultipartRejection},
    http::HeaderMap,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Default)]
pub(super) struct Registry(Arc<Mutex<HashMap<Uuid, (Uuid, CancellationToken)>>>);
struct Guard {
    registry: Registry,
    key: Uuid,
    attempt: Uuid,
    token: CancellationToken,
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.token.cancel();
        if let Ok(mut entries) = self.registry.0.lock()
            && entries
                .get(&self.key)
                .is_some_and(|(id, _)| *id == self.attempt)
        {
            entries.remove(&self.key);
        }
    }
}
impl Registry {
    pub(super) fn cancel_all(&self) {
        if let Ok(entries) = self.0.lock() {
            for (_, token) in entries.values() {
                token.cancel();
            }
        }
    }
    fn register(&self, u: &Upload) -> Result<Guard, Error> {
        let token = CancellationToken::new();
        self.0
            .lock()
            .map_err(|_| Error::Unavailable)?
            .insert(u.key, (u.attempt, token.clone()));
        Ok(Guard {
            registry: self.clone(),
            key: u.key,
            attempt: u.attempt,
            token,
        })
    }
    fn cancel(&self, key: Uuid) {
        if let Ok(entries) = self.0.lock()
            && let Some((_, token)) = entries.get(&key)
        {
            token.cancel();
        }
    }
}
pub(super) async fn create(
    State(s): State<SpaceApi>,
    Path(k): Path<String>,
    headers: HeaderMap,
    body: Result<Multipart, MultipartRejection>,
) -> Response {
    run(s, k, None, headers, body).await
}
pub(super) async fn replace(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Multipart, MultipartRejection>,
) -> Response {
    let Ok(id) = Uuid::parse_str(&id) else {
        return failure(Error::NotFound);
    };
    run(s, k, Some(id), headers, body).await
}
async fn run(
    s: SpaceApi,
    kind: String,
    target: Option<Uuid>,
    headers: HeaderMap,
    body: Result<Multipart, MultipartRejection>,
) -> Response {
    let Ok(kind) = Kind::parse(&kind) else {
        return failure(Error::NotFound);
    };
    let Some(key) = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
    else {
        return failure(Error::Validation(
            "UUID 형식의 Idempotency-Key가 필요합니다.",
        ));
    };
    let expected_version = headers
        .get("x-expected-version")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok());
    let u = Upload {
        key,
        attempt: Uuid::new_v4(),
        kind,
        target,
        expected_version,
    };
    let body = match body {
        Ok(b) => b,
        Err(_) => return failure(Error::Validation("multipart 파일 입력이 필요합니다.")),
    };
    if let Err(e) = s.libraries.begin(u.clone()).await {
        return failure(e);
    }
    let guard = match s.uploads.register(&u) {
        Ok(g) => g,
        Err(e) => {
            s.libraries.failed(u).await;
            return failure(e);
        }
    };
    let result = tokio::time::timeout(
        Duration::from_secs(300),
        receive(&s, u.clone(), body, guard.token.clone()),
    )
    .await
    .unwrap_or(Err(Error::Validation(
        "업로드 시간이 초과되었습니다. 다시 시도하세요.",
    )));
    match result {
        Ok(v) => json(
            if v.replayed {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            dto::ItemDto::from(v.item),
        ),
        Err(e) => {
            s.libraries.failed(u).await;
            failure(e)
        }
    }
}
fn multipart_error(e: axum::extract::multipart::MultipartError) -> Error {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        crate::modules::assets::Error::TooLarge.into()
    } else {
        Error::Validation("파일 전송이 중단되었거나 multipart 형식이 올바르지 않습니다.")
    }
}
async fn receive(
    s: &SpaceApi,
    u: Upload,
    mut body: Multipart,
    token: CancellationToken,
) -> Result<Saved, Error> {
    let mut sink = Some(s.assets.stage().await?);
    let mut filename = None;
    let mut format = None;
    let mut title = None;
    let mut tags = None;
    loop {
        let field = tokio::select! {_=token.cancelled()=>return Err(Error::Cancelled),field=body.next_field()=>field.map_err(multipart_error)?};
        let Some(mut field) = field else {
            break;
        };
        let name = field.name().unwrap_or("").to_owned();
        if name == "file" {
            if filename.is_some() {
                return Err(Error::Validation("요청당 파일 한 개를 전송하세요."));
            }
            let file_name = field
                .file_name()
                .ok_or(Error::Validation("파일 이름이 필요합니다."))?
                .to_owned();
            format = Some(u.kind.validate_file(&file_name)?);
            filename = Some(file_name);
            loop {
                let chunk = tokio::select! {_=token.cancelled()=>return Err(Error::Cancelled),chunk=field.chunk()=>chunk.map_err(multipart_error)?};
                let Some(chunk) = chunk else {
                    break;
                };
                sink.as_mut().ok_or(Error::Storage)?.write(&chunk).await?;
            }
        } else if name == "title" || name == "tags" {
            let mut bytes = Vec::new();
            while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
                if bytes.len() + chunk.len() > 4096 {
                    return Err(Error::Validation("메타데이터가 너무 큽니다."));
                }
                bytes.extend_from_slice(&chunk);
            }
            let text = String::from_utf8(bytes)
                .map_err(|_| Error::Validation("메타데이터는 UTF-8이어야 합니다."))?;
            let slot = if name == "title" {
                &mut title
            } else {
                &mut tags
            };
            if slot.replace(text).is_some() {
                return Err(Error::Validation("중복된 입력 필드입니다."));
            }
        } else {
            return Err(Error::Validation("지원하지 않는 입력 필드입니다."));
        }
    }
    let filename = filename.ok_or(Error::Validation("등록할 파일을 선택하세요."))?;
    let format = format.ok_or(Error::Storage)?;
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| filename.chars().take(120).collect());
    let tags: Vec<String> = match tags {
        Some(t) if !t.trim().is_empty() => serde_json::from_str(&t)
            .map_err(|_| Error::Validation("태그는 문자열 배열이어야 합니다."))?,
        _ => vec![],
    };
    let blob = tokio::select! {_=token.cancelled()=>return Err(Error::Cancelled),result=sink.take().ok_or(Error::Storage)?.finish(format,token.clone())=>result?};
    if token.is_cancelled() {
        return Err(Error::Cancelled);
    }
    s.libraries
        .register(Register {
            upload: u,
            title,
            tags,
            filename,
            blob,
            now: now()?,
        })
        .await
}
pub(super) async fn status(State(s): State<SpaceApi>, Path(key): Path<String>) -> Response {
    let Ok(key) = Uuid::parse_str(&key) else {
        return failure(Error::NotFound);
    };
    match s.libraries.status(key).await {
        Ok(v) => json(
            StatusCode::OK,
            serde_json::json!({"state":v.state,"item_id":v.item_id}),
        ),
        Err(e) => failure(e),
    }
}
pub(super) async fn cancel(State(s): State<SpaceApi>, Path(key): Path<String>) -> Response {
    let Ok(key) = Uuid::parse_str(&key) else {
        return failure(Error::NotFound);
    };
    match s.libraries.cancel(key).await {
        Ok(v) => {
            if v.state == "cancelled" {
                s.uploads.cancel(key);
            }
            json(
                StatusCode::OK,
                serde_json::json!({"state":v.state,"item_id":v.item_id}),
            )
        }
        Err(e) => failure(e),
    }
}
