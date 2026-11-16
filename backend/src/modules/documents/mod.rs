// Purpose: Own Space document processing commands and read views.
// Pattern: Service validates boundaries; worker and persistence handle durable stages.
// Usage: App composes one service for HTTP and the processing worker.
// Related: ports.rs, types.rs, worker.rs, adapters/http/documents.rs.
mod materials;
mod ports;
pub(crate) use materials::{Material, MaterialCatalog, NativeMaterial, NativePackage};
mod types;
mod worker;
use crate::modules::decisions::Decisions;
pub(crate) use ports::{Extractor, Store, Work};
use std::sync::Arc;
pub(crate) use types::*;
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct Documents {
    pub(super) store: Arc<dyn Store>,
    extractor: Arc<dyn Extractor>,
    decisions: Decisions,
    templates: crate::modules::templates::Templates,
}
impl Documents {
    pub fn new(
        store: Arc<dyn Store>,
        extractor: Arc<dyn Extractor>,
        decisions: Decisions,
        templates: crate::modules::templates::Templates,
    ) -> Self {
        Self {
            store,
            extractor,
            decisions,
            templates,
        }
    }
    pub async fn detail(
        &self,
        kind: String,
        item: Uuid,
        job: Option<Uuid>,
    ) -> Result<Detail, Error> {
        let mut detail = self.store.detail(kind, item, job).await?;
        if detail.job.kind == "templates"
            && detail.template.is_none()
            && let Some((analysis, package)) = self
                .templates
                .detail(detail.job.id)
                .await
                .map_err(|_| Error::Storage)?
        {
            detail.template = Some(analysis);
            detail.template_bundle = Some(package);
        }
        Ok(detail)
    }
    pub async fn history(&self, kind: String, item: Uuid) -> Result<Vec<Job>, Error> {
        self.store.history(kind, item).await
    }
    pub async fn blocks(
        &self,
        job: Uuid,
        page: Option<Uuid>,
        query: String,
        offset: u32,
    ) -> Result<Vec<Block>, Error> {
        if query.len() > 240 || offset > 100_000 {
            return Err(Error::Invalid("검색 조건을 확인하세요."));
        }
        self.store.blocks(job, page, false, query, offset).await
    }
    pub async fn enqueue(
        &self,
        kind: String,
        item: Uuid,
        expected: i64,
        key: Uuid,
    ) -> Result<Job, Error> {
        self.store
            .enqueue(kind, item, expected, key, self.extractor.profile())
            .await
    }
    pub async fn command(
        &self,
        id: Uuid,
        expected: i64,
        key: Uuid,
        action: String,
    ) -> Result<Job, Error> {
        if !["retry", "cancel"].contains(&action.as_str()) {
            return Err(Error::Invalid("지원하지 않는 작업입니다."));
        }
        self.store.command(id, expected, key, action).await
    }
    pub async fn artifact(&self, job: Uuid, hash: String) -> Result<(String, u64), Error> {
        self.store.artifact(job, hash).await
    }
    pub async fn materials(
        &self,
        job: Uuid,
        page: Option<Uuid>,
        kind: String,
        query: String,
        offset: u32,
        selection: Option<Vec<Uuid>>,
    ) -> Result<MaterialCatalog, Error> {
        if !["all", "slides", "visual", "text"].contains(&kind.as_str())
            || query.chars().count() > 80
            || offset > 100000
        {
            return Err(Error::Invalid("자료 종류와 검색 범위를 확인하세요."));
        }
        if let Some(ids) = &selection {
            let unique: std::collections::HashSet<_> = ids.iter().collect();
            if ids.is_empty() || ids.len() > 50 || unique.len() != ids.len() {
                return Err(Error::Invalid("서로 다른 자료를 1~50개 선택하세요."));
            }
        }
        self.store
            .materials(job, page, kind, query, offset, selection)
            .await
    }
    pub async fn settings(&self) -> Result<Settings, Error> {
        self.store.settings().await
    }
    pub async fn save_settings(
        &self,
        expected: i64,
        connection: Option<Uuid>,
    ) -> Result<Settings, Error> {
        self.store.save_settings(expected, connection).await
    }
}
