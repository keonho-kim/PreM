// Purpose: Register bounded local images for presentation editing without arbitrary model URLs.
// Pattern: Process adapter decodes to passive PNG; immutable originals and normalized bytes use CAS.
// Usage: Project-scoped upload/catalog/preview, then frozen media IDs in edit requests.
// Related: objects.rs, adapters/sqlite/presentations/media.rs, processes/presentation_media.rs.
use super::*;
use serde::Serialize;
#[derive(Clone, Serialize)]
pub(crate) struct Media {
    pub id: Uuid,
    pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip)]
    pub hash: String,
}
pub(crate) struct NormalizedImage {
    pub blob: DerivedBlob,
    pub width: u32,
    pub height: u32,
    pub source_mime: String,
}
impl Presentations {
    pub async fn media(&self, p: Uuid) -> Result<Vec<Media>, Error> {
        self.store.media(p).await
    }
    pub async fn upload_image(
        &self,
        p: Uuid,
        key: Uuid,
        name: String,
        bytes: Vec<u8>,
    ) -> Result<Media, Error> {
        if bytes.is_empty()
            || bytes.len() > 5 * 1024 * 1024
            || name.trim().is_empty()
            || name.chars().count() > 180
            || name.chars().any(char::is_control)
            || name.contains(['/', '\\'])
        {
            return Err(Error::ImageInvalid);
        }
        self.store.media(p).await?;
        let image = self.renderer.image(bytes.clone()).await?;
        let original = self
            .assets
            .publish(bytes, crate::modules::assets::DerivedFormat::Binary)
            .await
            .map_err(|_| Error::Storage)?;
        self.store
            .register_media(p, key, name, original, image)
            .await
    }
    pub async fn media_file(&self, p: Uuid, id: Uuid) -> Result<(FileReader, File), Error> {
        let media = self
            .store
            .media(p)
            .await?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or(Error::NotFound)?;
        let bytes = self
            .assets
            .bytes(media.hash.clone(), 8 * 1024 * 1024)
            .await
            .map_err(|_| Error::Storage)?;
        let file = File {
            hash: media.hash.clone(),
            size: bytes.len() as u64,
            mime: "image/png",
        };
        let reader = self
            .assets
            .read(media.hash)
            .await
            .map_err(|_| Error::Storage)?;
        Ok((reader, file))
    }
}
