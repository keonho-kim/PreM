// Purpose: Own native reusable template analysis separately from reference content extraction.
// Pattern: Template jobs link shared PPT imports; historical JSON and ZIP results remain readable.
// Usage: Template uploads and reads use this service; references consume the common import separately.
// Related: adapters/processes/templates.rs, adapters/sqlite/templates.rs.
use crate::modules::assets::DerivedBlob;
pub(crate) use crate::modules::ppt_imports::{Analysis, Preview};
use std::{future::Future, pin::Pin, sync::Arc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct Input {
    pub job_id: Uuid,
    pub lease: String,
    pub source_sha256: String,
    pub profile: String,
}
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("템플릿 추출이 중단되었습니다.")]
    Cancelled,
    #[error("템플릿을 추출할 수 없습니다.")]
    Failed,
    #[error("템플릿 도구가 준비되지 않았습니다.")]
    MissingRuntime,
    #[error("템플릿 결과를 저장할 수 없습니다.")]
    Storage,
}
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Extractor: Send + Sync {
    fn extract(&self, input: Input, cancel: CancellationToken) -> Work<(Analysis, DerivedBlob)>;
}
pub(crate) trait Store: Send + Sync {
    fn commit(&self, input: Input, analysis: Analysis, bundle: DerivedBlob) -> Work<()>;
    fn package(&self, job: Uuid) -> Work<Option<String>>;
}
#[derive(Clone)]
pub(crate) struct Templates {
    extractor: Arc<dyn Extractor>,
    store: Arc<dyn Store>,
    imports: crate::modules::ppt_imports::Imports,
}
impl Templates {
    pub fn new(
        extractor: Arc<dyn Extractor>,
        store: Arc<dyn Store>,
        imports: crate::modules::ppt_imports::Imports,
    ) -> Self {
        Self {
            extractor,
            store,
            imports,
        }
    }
    pub async fn detail(&self, job: Uuid) -> Result<Option<(Analysis, String)>, Error> {
        match self.store.package(job).await? {
            Some(hash) => Ok(Some((
                self.imports
                    .analysis(hash.clone())
                    .await
                    .map_err(|_| Error::Storage)?,
                hash,
            ))),
            None => Ok(None),
        }
    }
    pub async fn extract(&self, input: Input, cancel: CancellationToken) -> Result<(), Error> {
        let (a, b) = self.extractor.extract(input.clone(), cancel).await?;
        self.store.commit(input, a, b).await
    }
}
