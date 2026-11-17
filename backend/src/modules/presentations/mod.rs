// Purpose: Own presentation preparation, generation and immutable output access.
// Pattern: Consumer-owned persistence and renderer ports; model execution stays in inference.
// Usage: App composes one service/worker and HTTP exposes explicit commands.
// Related: types.rs, worker.rs, authoring/request.rs, adapters/sqlite/presentations/.
mod canvas;
mod layers;
pub(crate) use canvas::*;
pub(crate) use layers::*;
mod execution;
mod references;
pub(crate) use references::*;
mod history;
pub(crate) use history::*;
mod media;
mod quality;
pub(crate) use media::*;
pub(crate) use quality::*;
mod object_schema;
mod objects;
pub(crate) use objects::*;
mod authoring;
mod editing;
pub(crate) use editing::*;
mod selection;
pub(crate) use selection::{GenerationScope, GenerationSection, resolve_scope};
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
pub(crate) trait Store: LayerStore + CanvasStore + QualityStore + Send + Sync {
    fn generation_scope(&self, p: Uuid, design: Uuid) -> Work<GenerationScope>;
    fn material_sources(&self, p: Uuid, r: Uuid, s: Uuid) -> Work<Vec<MaterialSource>>;
    fn edit_begin_node(&self, e: Edit, n: crate::workflows::engine::Node) -> Work<bool>;
    fn edit_finish_node(&self, e: Edit, n: crate::workflows::engine::Node) -> Work<()>;
    fn generation_materials(&self, r: Run) -> Work<Vec<ImportedMaterial>>;
    fn generation_imports(&self, r: Run) -> Work<Option<(String, Vec<ImportedMaterial>)>>;
    fn apply_generation_imports(&self, r: Run, specs: Vec<InsertedSpec>) -> Work<()>;
    fn imports(&self, p: Uuid) -> Work<Vec<ImportedMaterial>>;
    fn insertion_plan(
        &self,
        p: Uuid,
        r: Uuid,
        key: Uuid,
        i: &InsertMaterials,
    ) -> Work<InsertionPlan>;
    fn insert_materials(&self, commit: InsertionCommit) -> Work<Run>;
    fn begin_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<bool>;
    fn finish_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<()>;
    fn store_render(&self, r: Run, o: Rendered) -> Work<()>;
    fn rendered(&self, r: Run) -> Work<Option<Rendered>>;

    fn history(&self, p: Uuid, run: Uuid, session: Option<Uuid>) -> Work<History>;
    fn undo(&self, p: Uuid, run: Uuid, key: Uuid, version: i64, session: Uuid) -> Work<Run>;
    fn open_editor(&self, p: Uuid, run: Uuid, id: Uuid) -> Work<Uuid>;
    fn touch_editor(&self, p: Uuid, id: Uuid) -> Work<()>;
    fn close_editor(&self, p: Uuid, id: Uuid) -> Work<()>;
    fn expire_editors(&self, all: bool) -> Work<()>;
    fn edit_render_source(&self, e: Edit) -> Work<(Vec<StoredSlide>, Option<String>)>;
    fn edit_render_ready(&self, e: Edit, r: Rendered) -> Work<()>;
    fn edit_preview(&self, p: Uuid, id: Uuid, slide: Uuid) -> Work<File>;
    fn cached_render(&self, r: Run) -> Work<Option<Rendered>>;

    fn media(&self, p: Uuid) -> Work<Vec<Media>>;
    fn register_media(
        &self,
        p: Uuid,
        key: Uuid,
        name: String,
        original: DerivedBlob,
        image: NormalizedImage,
    ) -> Work<Media>;
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
        session: Option<Uuid>,
    ) -> Work<Edit>;
    fn claim_edit(&self) -> Work<Option<Edit>>;
    fn edit_heartbeat(&self, e: Edit) -> Work<bool>;
    fn edit_context(&self, e: Edit) -> Work<serde_json::Value>;
    fn edit_ready(
        &self,
        e: Edit,
        target: Uuid,
        blob: DerivedBlob,
        message: String,
        request: Uuid,
        assets: UsedAssets,
    ) -> Work<()>;
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
        references: Vec<Uuid>,
    ) -> Work<()>;
    fn render_source(&self, r: Run) -> Work<Option<String>>;
    fn complete(&self, r: Run, output: Rendered) -> Work<()>;
    fn fail(&self, r: Run, code: String) -> Work<()>;
}
pub(crate) trait Renderer: Send + Sync {
    fn layouts(&self, template: Option<String>) -> Work<Vec<CanvasLayout>>;
    fn image(&self, bytes: Vec<u8>) -> Work<NormalizedImage>;
    fn profile(&self) -> String;
    fn render(&self, input: RenderInput, cancel: CancellationToken) -> Work<SlideOutput>;
    fn assemble(&self, parts: Vec<DerivedBlob>, cancel: CancellationToken) -> Work<DerivedBlob>;
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
        if let Some(ids) = &mut i.node_ids {
            if ids.is_empty() || ids.len() > 24 {
                return Err(Error::Invalid);
            }
            ids.sort();
            if ids.windows(2).any(|p| p[0] == p[1]) {
                return Err(Error::Invalid);
            }
        }
        if i.title.is_empty()
            || i.title.chars().count() > 120
            || i.instructions.chars().count() > 1000
            || i.materials.len() > 10
            || i.expected_version < 0
            || i.model_version.is_some_and(|v| v < 1)
            || i.connection_id.is_some() != i.model_version.is_some()
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
