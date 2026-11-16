// Purpose: Adapt asset metadata, immutable versions and downloads to HTTP.
// Pattern: Registration services enforce scope and CAS; this adapter supplies safe file headers.
// Usage: Shared by Space and project-source route bindings.
// Related: mod.rs, sources.rs, modules/libraries/.
use super::*;
pub(super) async fn detail(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
) -> Response {
    let Ok((k, id)) = target(&k, &id) else {
        return failure(Error::NotFound);
    };
    match s.libraries.get(k, id).await {
        Ok(v) => json(StatusCode::OK, dto::ItemDto::from(v)),
        Err(e) => failure(e),
    }
}
pub(super) async fn versions(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
) -> Response {
    let Ok((k, id)) = target(&k, &id) else {
        return failure(Error::NotFound);
    };
    match s.libraries.versions(k, id).await {
        Ok(v) => json(
            StatusCode::OK,
            v.into_iter().map(dto::VersionDto::from).collect::<Vec<_>>(),
        ),
        Err(e) => failure(e),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Update {
    expected_version: i64,
    title: Option<String>,
    tags: Option<Vec<String>>,
    status: Option<String>,
}
pub(super) async fn update(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
    body: Result<Json<Update>, JsonRejection>,
) -> Response {
    let Ok((k, id)) = target(&k, &id) else {
        return failure(Error::NotFound);
    };
    let Ok(Json(b)) = body else {
        return failure(Error::Validation("JSON 입력을 확인하세요."));
    };
    let change = match (b.title, b.tags, b.status) {
        (Some(title), Some(tags), None) => Change::Metadata { title, tags },
        (None, None, Some(status)) => Change::Status(status),
        _ => {
            return failure(Error::Validation(
                "이름·태그 또는 상태 중 하나의 변경을 요청하세요.",
            ));
        }
    };
    match s.libraries.change(k, id, b.expected_version, change).await {
        Ok(v) => json(StatusCode::OK, dto::ItemDto::from(v)),
        Err(e) => failure(e),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Delete {
    expected_version: i64,
}
pub(super) async fn remove(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
    body: Result<Json<Delete>, JsonRejection>,
) -> Response {
    let Ok((k, id)) = target(&k, &id) else {
        return failure(Error::NotFound);
    };
    let Ok(Json(b)) = body else {
        return failure(Error::Validation("기준 버전을 확인하세요."));
    };
    match s
        .libraries
        .change(k, id, b.expected_version, Change::Delete)
        .await
    {
        Ok(v) => json(StatusCode::OK, dto::ItemDto::from(v)),
        Err(e) => failure(e),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Download {
    version: Option<i64>,
}
pub(super) async fn download(
    State(s): State<SpaceApi>,
    Path((k, id)): Path<(String, String)>,
    query: Result<Query<Download>, QueryRejection>,
) -> Response {
    let Ok((k, id)) = target(&k, &id) else {
        return failure(Error::NotFound);
    };
    let Ok(Query(q)) = query else {
        return failure(Error::Validation("파일 버전이 올바르지 않습니다."));
    };
    let versions = match s.libraries.versions(k, id).await {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    let Some(file) = versions
        .into_iter()
        .find(|v| q.version.is_none_or(|n| n == v.number))
    else {
        return failure(Error::NotFound);
    };
    let reader = match s.assets.read(file.blob_sha256).await {
        Ok(r) => r,
        Err(e) => return failure(e.into()),
    };
    let mut response =
        axum::body::Body::from_stream(tokio_util::io::ReaderStream::new(reader)).into_response();
    if matches!(file.mime.as_str(), "text/html" | "text/markdown") {
        response.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static(
                "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
            ),
        );
    }
    let disposition = format!(
        "attachment; filename=download; filename*=UTF-8''{}",
        percent_encoding::utf8_percent_encode(&file.filename, percent_encoding::NON_ALPHANUMERIC)
    );
    for (name, value) in [
        (header::CONTENT_TYPE, file.mime),
        (header::CONTENT_DISPOSITION, disposition),
        (header::CONTENT_LENGTH, file.size.to_string()),
        (header::CACHE_CONTROL, "no-store".into()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
    ] {
        let Ok(value) = header::HeaderValue::from_str(&value) else {
            return failure(Error::Storage);
        };
        response.headers_mut().insert(name, value);
    }
    response
}
