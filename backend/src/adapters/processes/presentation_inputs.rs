// Purpose: Stage only authorized source assets for a single native presentation render.
// Pattern: Owned paths, bounded bytes and immutable canonical media/reference identities.
// Usage: Presentation process adapter before starting bundled Python or Node helpers.
// Related: presentations.rs, presentation-references.py, modules/presentations/quality.rs.
use super::*;
use crate::modules::presentations::{self, RenderInput};
impl Runtime {
    pub(super) async fn presentation_inputs(
        &self,
        dir: &Path,
        input: &RenderInput,
    ) -> Result<(), Error> {
        if let Some(hash) = input.template_sha256.clone() {
            let bytes = self
                .assets
                .bytes(hash, 50 * 1024 * 1024)
                .await
                .map_err(|_| Error::Storage)?;
            tokio::fs::write(dir.join("template.pptx"), bytes)
                .await
                .map_err(|_| Error::Storage)?;
        }
        let used: std::collections::HashSet<_> = input
            .specs
            .iter()
            .flat_map(|(_, s)| s.objects.iter())
            .filter_map(|o| {
                if let presentations::ObjectContent::Image { media_id } = &o.content {
                    Some(*media_id)
                } else {
                    None
                }
            })
            .collect();
        for id in used {
            let m = input
                .media
                .iter()
                .find(|m| m.id == id)
                .ok_or(Error::Processing("image_missing"))?;
            let bytes = self
                .assets
                .bytes(m.hash.clone(), 8 * 1024 * 1024)
                .await
                .map_err(|_| Error::Storage)?;
            tokio::fs::write(dir.join(format!("media-{id}.png")), bytes)
                .await
                .map_err(|_| Error::Storage)?;
        }
        let used: std::collections::HashSet<_> = input
            .specs
            .iter()
            .flat_map(|(_, s)| s.objects.iter())
            .filter_map(|o| {
                if let presentations::ObjectContent::Reference { reference_id } = &o.content {
                    Some(*reference_id)
                } else {
                    None
                }
            })
            .collect();
        let mut references = vec![];
        let mut staged = std::collections::HashSet::new();
        let mut source_bytes = 0;
        for id in used {
            let item = input
                .references
                .iter()
                .find(|m| m.id == id)
                .ok_or(Error::Processing("reference_missing"))?;
            if item.locator.is_some() && staged.insert(item.source_hash.clone()) {
                let bytes = self
                    .assets
                    .bytes(item.source_hash.clone(), 50 * 1024 * 1024)
                    .await
                    .map_err(|_| Error::Storage)?;
                source_bytes += bytes.len();
                if source_bytes > 150 * 1024 * 1024 {
                    return Err(Error::Processing("reference_limit"));
                }
                tokio::fs::write(dir.join(format!("ref-{}.pptx", item.source_hash)), bytes)
                    .await
                    .map_err(|_| Error::Storage)?;
            } else if let Some(hash) = item.preview.as_ref().filter(|_| item.locator.is_none()) {
                let bytes = self
                    .assets
                    .bytes(hash.clone(), 8 * 1024 * 1024)
                    .await
                    .map_err(|_| Error::Storage)?;
                tokio::fs::write(dir.join(format!("ref-{id}.png")), bytes)
                    .await
                    .map_err(|_| Error::Storage)?;
            }
            references.push(item);
        }
        tokio::fs::write(
            dir.join("references.json"),
            serde_json::to_vec(&references).map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        let specs: Vec<_> = input.specs.iter().map(|(_, s)| s).collect();
        tokio::fs::write(
            dir.join("specs.json"),
            serde_json::to_vec(&specs).map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        tokio::fs::write(
            dir.join("render-options.json"),
            serde_json::to_vec(&serde_json::json!({"repair":input.repair,"offset":input.offset,"typography":input.typography}))
                .map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        Ok(())
    }
}
