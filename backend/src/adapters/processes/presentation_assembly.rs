// Purpose: Assemble validated single-slide native decks without rendering unchanged slides again.
// Pattern: Bounded canonical Blob reads, supervised process and same-filesystem workspace cleanup.
// Usage: Presentation quality service after all individual quality checkpoints pass.
// Related: presentation-assemble.py, presentations.rs, modules/presentations/quality.rs.
use super::*;
use crate::modules::assets::{DerivedBlob, DerivedFormat};
impl Runtime {
    pub(super) async fn assemble_presentation(
        &self,
        parts: Vec<DerivedBlob>,
        cancel: CancellationToken,
    ) -> Result<DerivedBlob, Error> {
        if parts.is_empty() || parts.len() > 24 {
            return Err(Error::Processing("slide_limit"));
        }
        if parts.len() == 1 {
            return Ok(parts[0].clone());
        }
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("runtime_missing"))?;
        for (name, expected) in [
            (
                "presentation-assemble.py",
                include_bytes!("../../../tools/presentation-assemble.py").as_slice(),
            ),
            (
                "presentation-references.py",
                include_bytes!("../../../tools/presentation-references.py").as_slice(),
            ),
        ] {
            if tokio::fs::read(self.root.join(name))
                .await
                .map_err(|_| Error::Storage)?
                != expected
            {
                return Err(Error::Processing("runtime_changed"));
            }
        }
        let dir = tempfile::Builder::new()
            .prefix(".prem-process-")
            .tempdir_in(&self.work)
            .map_err(|_| Error::Storage)?;
        let mut hashes = vec![];
        let mut seen = std::collections::HashSet::new();
        let mut total = 0;
        for part in parts {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if seen.insert(part.sha256.clone()) {
                let bytes = self
                    .assets
                    .bytes(part.sha256.clone(), 50 * 1024 * 1024)
                    .await
                    .map_err(|_| Error::Storage)?;
                total += bytes.len();
                if total > 150 * 1024 * 1024 {
                    return Err(Error::Processing("output_limit"));
                }
                tokio::fs::write(dir.path().join(format!("ref-{}.pptx", part.sha256)), bytes)
                    .await
                    .map_err(|_| Error::Storage)?;
            }
            hashes.push(part.sha256);
        }
        tokio::fs::write(
            dir.path().join("parts.json"),
            serde_json::to_vec(&hashes).map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        let mut cmd = Command::new(&manifest.python);
        cmd.arg(self.root.join("presentation-assemble.py"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir.path());
        self.run(cmd, cancel.clone()).await.map_err(|e| match e {
            Error::Cancelled => e,
            _ => Error::Processing("presentation_assembly_failed"),
        })?;
        self.presentation_blob(
            &dir.path().join("output.pptx"),
            50 * 1024 * 1024,
            DerivedFormat::Binary,
        )
        .await
    }
}
