// Purpose: Supervise bounded raster normalization for project slide images.
// Pattern: Existing Sharp decoder, per-runtime admission and owned temporary workspace.
// Usage: Presentations image port; the model cannot supply source paths or URLs.
// Related: backend/tools/presentation-image.mjs, modules/presentations/media.rs.
use super::*;
use crate::modules::{
    assets::DerivedFormat,
    presentations::{self, NormalizedImage},
};
impl Runtime {
    pub(super) async fn normalize_image(
        &self,
        bytes: Vec<u8>,
    ) -> Result<NormalizedImage, presentations::Error> {
        use presentations::Error as E;
        let _permit = self.media_gate.try_acquire().map_err(|_| E::Busy)?;
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(E::Processing("runtime_missing"))?;
        if tokio::fs::read(self.root.join("presentation-image.mjs"))
            .await
            .map_err(|_| E::Storage)?
            != include_bytes!("../../../tools/presentation-image.mjs")
        {
            return Err(E::Processing("runtime_changed"));
        }
        let dir = tempfile::Builder::new()
            .prefix(".prem-process-")
            .tempdir_in(&self.work)
            .map_err(|_| E::Storage)?;
        tokio::fs::write(dir.path().join("input"), bytes)
            .await
            .map_err(|_| E::Storage)?;
        let mut cmd = Command::new(&manifest.node);
        cmd.arg("--max-old-space-size=256")
            .arg("--permission")
            .arg("--allow-addons")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.path().display()))
            .arg(format!("--allow-fs-write={}", dir.path().display()))
            .arg(self.root.join("presentation-image.mjs"))
            .arg(dir.path())
            .current_dir(dir.path());
        self.run(cmd, CancellationToken::new())
            .await
            .map_err(|_| E::ImageInvalid)?;
        #[derive(Deserialize)]
        struct Info {
            width: u32,
            height: u32,
            source_mime: String,
        }
        let info: Info = serde_json::from_slice(
            &tokio::fs::read(dir.path().join("image.json"))
                .await
                .map_err(|_| E::Storage)?,
        )
        .map_err(|_| E::Storage)?;
        let blob = self
            .assets
            .publish(
                tokio::fs::read(dir.path().join("image.png"))
                    .await
                    .map_err(|_| E::Storage)?,
                DerivedFormat::Png,
            )
            .await
            .map_err(|_| E::Storage)?;
        Ok(NormalizedImage {
            blob,
            width: info.width,
            height: info.height,
            source_mime: info.source_mime,
        })
    }
}
