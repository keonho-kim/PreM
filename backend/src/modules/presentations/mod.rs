// Purpose: Own presentation preparation, generation and immutable output access.
// Pattern: Consumer-owned persistence and renderer ports; model execution stays in inference.
// Usage: App composes one service/worker and HTTP exposes explicit commands.
// Related: types.rs, worker.rs, model.rs, adapters/sqlite/presentations/.
mod edit_model;
mod edit_types;
mod edits;
mod model;
pub(crate) use edit_types::*;
mod types;
mod worker;
use crate::modules::assets::{AssetService, DerivedBlob, FileReader};
use std::{future::Future, pin::Pin, sync::Arc};
use tokio_util::sync::CancellationToken;
pub(crate) use types::*;
use uuid::Uuid;
pub(crate) type Work<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) struct StoredSlide {
    pub id: Uuid,
    pub position: i64,
    pub spec: Option<String>,
    pub preview: bool,
}
pub(crate) struct File {
    pub hash: String,
    pub size: u64,
    pub mime: &'static str,
}
pub(crate) trait Store: Send + Sync {
    fn create_edit(
        &self,
        p: Uuid,
        run: Uuid,
        slide: Uuid,
        key: Uuid,
        input: EditRequest,
        profile: String,
    ) -> Work<Edit>;
    fn edits(&self, p: Uuid, run: Uuid, slide: Uuid) -> Work<Vec<Edit>>;
    fn edit_command(
        &self,
        p: Uuid,
        id: Uuid,
        key: Uuid,
        version: i64,
        action: String,
    ) -> Work<Edit>;
    fn claim_edit(&self) -> Work<Option<Edit>>;
    fn edit_heartbeat(&self, e: Edit) -> Work<bool>;
    fn edit_context(&self, e: Edit) -> Work<serde_json::Value>;
    fn edit_ready(&self, e: Edit, blob: DerivedBlob, message: String, request: Uuid) -> Work<()>;
    fn edit_fail(&self, e: Edit, code: String) -> Work<()>;

    fn citations(&self, p: Uuid, id: Uuid, slide: Uuid) -> Work<Vec<Citation>>;
    fn preparation(&self, p: Uuid) -> Work<Preparation>;
    fn confirm(&self, p: Uuid, fingerprint: String) -> Work<Preparation>;
    fn design(&self, p: Uuid, input: Design) -> Work<Preparation>;
    fn create(&self, p: Uuid, key: Uuid, input: Generate, profile: String) -> Work<Run>;
    fn runs(&self, p: Uuid) -> Work<Vec<Run>>;
    fn slides(&self, p: Uuid, id: Uuid) -> Work<Vec<StoredSlide>>;
    fn file(&self, p: Uuid, id: Uuid, slide: Option<Uuid>) -> Work<File>;
    fn command(&self, p: Uuid, id: Uuid, key: Uuid, version: i64, action: String) -> Work<Run>;
    fn claim(&self) -> Work<Option<Run>>;
    fn heartbeat(&self, r: Run) -> Work<bool>;
    fn plan(&self, r: Run) -> Work<Option<Plan>>;
    fn checkpoint(
        &self,
        r: Run,
        slide: Uuid,
        spec: DerivedBlob,
        blocks: Vec<Uuid>,
        request: Uuid,
    ) -> Work<()>;
    fn render_source(&self, r: Run) -> Work<Option<String>>;
    fn complete(&self, r: Run, output: Rendered) -> Work<()>;
    fn fail(&self, r: Run, code: String) -> Work<()>;
}
pub(crate) trait Renderer: Send + Sync {
    fn profile(&self) -> String;
    fn render(&self, input: RenderInput, cancel: CancellationToken) -> Work<Rendered>;
}
#[derive(Clone)]
pub(crate) struct Presentations {
    store: Arc<dyn Store>,
    renderer: Arc<dyn Renderer>,
    inference: crate::modules::inference::Inference,
    assets: AssetService,
}
impl Presentations {
    pub fn new(
        store: Arc<dyn Store>,
        renderer: Arc<dyn Renderer>,
        inference: crate::modules::inference::Inference,
        assets: AssetService,
    ) -> Self {
        Self {
            store,
            renderer,
            inference,
            assets,
        }
    }
    pub async fn citations(&self, p: Uuid, id: Uuid, slide: Uuid) -> Result<Vec<Citation>, Error> {
        self.store.citations(p, id, slide).await
    }
    pub async fn preparation(&self, p: Uuid) -> Result<Preparation, Error> {
        self.store.preparation(p).await
    }
    pub async fn confirm(&self, p: Uuid, f: String) -> Result<Preparation, Error> {
        if f.len() != 64 {
            return Err(Error::Invalid);
        }
        self.store.confirm(p, f).await
    }
    pub async fn design(&self, p: Uuid, i: Design) -> Result<Preparation, Error> {
        self.store.design(p, i).await
    }
    pub async fn create(&self, p: Uuid, k: Uuid, mut i: Generate) -> Result<Run, Error> {
        i.title = i.title.trim().into();
        if i.title.is_empty()
            || i.title.chars().count() > 120
            || i.instructions.chars().count() > 1000
            || i.expected_version < 0
            || i.model_version < 1
        {
            return Err(Error::Invalid);
        }
        self.store.create(p, k, i, self.renderer.profile()).await
    }
    pub async fn runs(&self, p: Uuid) -> Result<Vec<Run>, Error> {
        self.store.runs(p).await
    }
    pub async fn slides(&self, p: Uuid, id: Uuid) -> Result<Vec<Slide>, Error> {
        let mut out = vec![];
        for row in self.store.slides(p, id).await? {
            let spec = if let Some(hash) = row.spec {
                Some(
                    serde_json::from_slice(
                        &self
                            .assets
                            .bytes(hash, 65536)
                            .await
                            .map_err(|_| Error::Storage)?,
                    )
                    .map_err(|_| Error::Storage)?,
                )
            } else {
                None
            };
            out.push(Slide {
                id: row.id,
                position: row.position,
                spec,
                preview: row.preview,
            });
        }
        Ok(out)
    }
    pub async fn file(
        &self,
        p: Uuid,
        id: Uuid,
        slide: Option<Uuid>,
    ) -> Result<(FileReader, File), Error> {
        let file = self.store.file(p, id, slide).await?;
        let reader = self
            .assets
            .read(file.hash.clone())
            .await
            .map_err(|_| Error::Storage)?;
        Ok((reader, file))
    }
    pub async fn command(
        &self,
        p: Uuid,
        id: Uuid,
        k: Uuid,
        v: i64,
        a: String,
    ) -> Result<Run, Error> {
        if !["retry", "cancel"].contains(&a.as_str()) {
            return Err(Error::Invalid);
        }
        self.store.command(p, id, k, v, a).await
    }
}
