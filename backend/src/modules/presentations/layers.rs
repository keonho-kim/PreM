// Purpose: Expose authorized passive artwork layers while preserving the canonical full preview fallback.
// Pattern: Derived PNG identities only; source markup and provider execution never enter the browser.
// Usage: Direct canvas rendering reads committed quality/render-cache associations.
// Related: sqlite/presentations/layers.rs, presentation-layers.py, V31 migration.
use super::*;
use serde::Serialize;
#[derive(Clone)]
pub(crate) struct CanvasLayer {
    pub id: String,
    pub frame: Frame,
    pub blob: DerivedBlob,
}
#[derive(Serialize)]
pub(crate) struct LayerView {
    pub id: String,
    pub frame: Frame,
}
pub(crate) trait LayerStore: Send + Sync {
    fn layers(&self, p: Uuid, run: Uuid, slide: Uuid) -> Work<Vec<LayerView>>;
    fn layer_file(&self, p: Uuid, run: Uuid, slide: Uuid, id: String) -> Work<File>;
}
impl Presentations {
    pub async fn layers(&self, p: Uuid, run: Uuid, slide: Uuid) -> Result<Vec<LayerView>, Error> {
        self.store.layers(p, run, slide).await
    }
    pub async fn layer_file(
        &self,
        p: Uuid,
        run: Uuid,
        slide: Uuid,
        id: String,
    ) -> Result<(FileReader, File), Error> {
        let file = self.store.layer_file(p, run, slide, id).await?;
        let reader = self
            .assets
            .read(file.hash.clone())
            .await
            .map_err(|_| Error::Storage)?;
        Ok((reader, file))
    }
}
