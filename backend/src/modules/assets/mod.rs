// Purpose: Define uploaded-file facts, accepted formats and the binary storage boundary.
// Pattern: File bytes stay outside domain records; adapters own filesystem handles.
// Usage: HTTP streams into an UploadSink; libraries commit the resulting immutable Blob.
// Related: adapters/filesystem/blobs.rs, adapters/formats/, modules/libraries/.
mod packages;
pub(crate) use packages::{PACKAGE_MIME, Package, PackageFile};
use std::{future::Future, pin::Pin, sync::Arc};
use tokio::io::AsyncRead;
pub(crate) const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) type AssetFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send + 'a>>;
pub(crate) type FileReader = Box<dyn AsyncRead + Send + Unpin>;
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("업로드가 취소되었습니다.")]
    Cancelled,
    #[error("지원하지 않는 파일 형식이거나 파일명이 올바르지 않습니다.")]
    InvalidFile,
    #[error("파일 내용이 손상되었거나 확장자와 일치하지 않습니다.")]
    InvalidContent,
    #[error("HTML 파일을 UTF-8 인코딩으로 저장한 뒤 다시 올려주세요.")]
    HtmlEncoding,
    #[error("HTML 구조가 너무 복잡합니다. 문서를 나눠서 올려주세요.")]
    HtmlComplexity,
    #[error("Markdown 파일을 UTF-8 인코딩으로 저장한 뒤 다시 올려주세요.")]
    MarkdownEncoding,
    #[error("Markdown은 최대 2 MiB이며, 너무 긴 줄이나 복잡한 구조는 문서를 나눠서 올려주세요.")]
    MarkdownLimit,
    #[error("암호화된 파일은 등록할 수 없습니다.")]
    Encrypted,
    #[error("파일 또는 압축 해제 용량 제한을 초과했습니다. 파일당 최대 50 MiB입니다.")]
    TooLarge,
    #[error("저장 공간이 부족합니다.")]
    NoSpace,
    #[error("현재 업로드가 많습니다. 잠시 후 다시 시도하세요.")]
    Busy,
    #[error("파일을 저장하거나 읽지 못했습니다.")]
    Storage,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Format {
    Pdf,
    Hwp,
    Hwpx,
    Docx,
    Pptx,
    Xlsx,
    Html,
    Markdown,
}
impl Format {
    pub fn from_filename(name: &str) -> Result<Self, Error> {
        if name.trim().is_empty()
            || name.chars().count() > 180
            || name.chars().any(char::is_control)
            || name.contains(['/', '\\'])
        {
            return Err(Error::InvalidFile);
        }
        match name
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "pdf" => Ok(Self::Pdf),
            "hwp" => Ok(Self::Hwp),
            "hwpx" => Ok(Self::Hwpx),
            "docx" => Ok(Self::Docx),
            "pptx" => Ok(Self::Pptx),
            "xlsx" => Ok(Self::Xlsx),
            "html" | "htm" => Ok(Self::Html),
            "md" | "markdown" => Ok(Self::Markdown),
            _ => Err(Error::InvalidFile),
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Hwp => "hwp",
            Self::Hwpx => "hwpx",
            Self::Docx => "docx",
            Self::Pptx => "pptx",
            Self::Xlsx => "xlsx",
            Self::Html => "html",
            Self::Markdown => "md",
        }
    }
    pub fn mime(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Html => "text/html",
            Self::Markdown => "text/markdown",
            Self::Hwp => "application/x-hwp",
            Self::Hwpx => "application/hwp+zip",
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Pptx => {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            }
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
    }
}
#[derive(Clone, Debug)]
pub(crate) struct Blob {
    pub sha256: String,
    pub size: u64,
    pub format: Format,
}
pub(crate) trait UploadSink: Send {
    fn write<'a>(&'a mut self, data: &'a [u8]) -> AssetFuture<'a, ()>;
    fn finish(
        self: Box<Self>,
        format: Format,
        cancel: tokio_util::sync::CancellationToken,
    ) -> AssetFuture<'static, Blob>;
}
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DerivedFormat {
    Png,
    Zip,
    Binary,
    Package,
}
#[derive(Clone)]
pub(crate) struct DerivedBlob {
    pub sha256: String,
    pub size: u64,
    pub format: DerivedFormat,
}
pub(crate) trait BlobStorage: Send + Sync {
    fn publish(&self, bytes: Vec<u8>, format: DerivedFormat) -> AssetFuture<'_, DerivedBlob>;
    fn archive(&self, hash: String) -> AssetFuture<'_, (FileReader, u64)>;
    fn shutdown(&self) -> AssetFuture<'_, ()>;
    fn stage(&self) -> AssetFuture<'_, Box<dyn UploadSink>>;
    fn read(&self, hash: String) -> AssetFuture<'_, FileReader>;
}
#[derive(Clone)]
pub(crate) struct AssetService {
    storage: Arc<dyn BlobStorage>,
}
impl AssetService {
    pub fn new(storage: Arc<dyn BlobStorage>) -> Self {
        Self { storage }
    }
    pub async fn publish(
        &self,
        bytes: Vec<u8>,
        format: DerivedFormat,
    ) -> Result<DerivedBlob, Error> {
        self.storage.publish(bytes, format).await
    }
    pub async fn package(&self, hash: String) -> Result<Package, Error> {
        let bytes = self.bytes(hash, 4 * 1024 * 1024).await?;
        let package: Package = serde_json::from_slice(&bytes).map_err(|_| Error::InvalidContent)?;
        package.validate()?;
        Ok(package)
    }
    pub async fn bytes(&self, hash: String, limit: u64) -> Result<Vec<u8>, Error> {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        self.read(hash.clone())
            .await?
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| Error::Storage)?;
        use sha2::{Digest, Sha256};
        if bytes.len() as u64 > limit || hex::encode(Sha256::digest(&bytes)) != hash {
            return Err(Error::InvalidContent);
        }
        Ok(bytes)
    }
    pub async fn archive(&self, hash: String) -> Result<(FileReader, u64), Error> {
        self.storage.archive(hash).await
    }
    pub async fn shutdown(&self) -> Result<(), Error> {
        self.storage.shutdown().await
    }
    pub async fn stage(&self) -> Result<Box<dyn UploadSink>, Error> {
        self.storage.stage().await
    }
    pub async fn read(&self, hash: String) -> Result<FileReader, Error> {
        self.storage.read(hash).await
    }
}
