// Purpose: Own reusable PPT imports shared by templates and reference documents.
// Pattern: Source/profile identity points to canonical package files; jobs only retain links.
// Usage: Process adapters publish once; template reads hydrate JSON from the same package.
// Related: assets/packages.rs, adapters/sqlite/ppt_imports.rs, adapters/processes/pptx.rs.
use crate::modules::assets::{AssetService, DerivedBlob, Package};
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin, sync::Arc};
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Analysis {
    pub schema_version: i64,
    pub manifest: serde_json::Value,
    pub native_structure: serde_json::Value,
    #[serde(default)]
    pub previews: Vec<Preview>,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Preview {
    pub ordinal: i64,
    pub width: u32,
    pub height: u32,
    pub sha256: String,
    #[serde(default, skip_serializing)]
    pub size: u64,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("PPT 공통 추출 결과를 저장하거나 읽을 수 없습니다.")]
    Storage,
}
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait Store: Send + Sync {
    fn find(&self, source: String, profile: String) -> Work<Option<DerivedBlob>>;
    fn commit(
        &self,
        source: String,
        profile: String,
        blob: DerivedBlob,
        package: Package,
    ) -> Work<()>;
}
#[derive(Clone)]
pub(crate) struct Imports {
    store: Arc<dyn Store>,
    assets: AssetService,
}
impl Imports {
    pub fn new(store: Arc<dyn Store>, assets: AssetService) -> Self {
        Self { store, assets }
    }
    pub async fn find(
        &self,
        source: String,
        profile: String,
    ) -> Result<Option<DerivedBlob>, Error> {
        self.store.find(source, profile).await
    }
    pub async fn commit(
        &self,
        source: String,
        profile: String,
        blob: DerivedBlob,
        package: Package,
    ) -> Result<(), Error> {
        self.store.commit(source, profile, blob, package).await
    }
    pub async fn analysis(&self, hash: String) -> Result<Analysis, Error> {
        let package = self
            .assets
            .package(hash)
            .await
            .map_err(|_| Error::Storage)?;
        async fn json(
            assets: &AssetService,
            package: &Package,
            path: &str,
        ) -> Result<serde_json::Value, Error> {
            let file = package
                .files
                .iter()
                .find(|f| f.path == path)
                .ok_or(Error::Storage)?;
            let bytes = assets
                .bytes(file.sha256.clone(), 8 * 1024 * 1024)
                .await
                .map_err(|_| Error::Storage)?;
            serde_json::from_slice(&bytes).map_err(|_| Error::Storage)
        }
        let manifest = json(&self.assets, &package, "analysis/manifest.json").await?;
        let native_structure =
            json(&self.assets, &package, "analysis/native_structure.json").await?;
        let mut previews: Vec<Preview> =
            serde_json::from_value(json(&self.assets, &package, "analysis/previews.json").await?)
                .map_err(|_| Error::Storage)?;
        for p in &mut previews {
            let file = package
                .files
                .iter()
                .find(|f| f.path == format!("previews/{}.png", p.ordinal))
                .ok_or(Error::Storage)?;
            if p.sha256 != file.sha256 {
                return Err(Error::Storage);
            }
            p.size = file.size;
        }
        Ok(Analysis {
            schema_version: 1,
            manifest,
            native_structure,
            previews,
        })
    }
}
