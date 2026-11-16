// Purpose: Publish and rehydrate native PPT workspaces through normalized package manifests.
// Pattern: Only bounded verified regular files cross the process/filesystem boundary.
// Usage: Shared PPT import captures once and reuses members for later reference analysis.
// Related: pptx.rs, modules/assets/packages.rs, modules/ppt_imports/.
use super::*;
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat, Package, PackageFile},
    ppt_imports::Analysis,
};
impl Runtime {
    pub(super) async fn capture_package(
        &self,
        dir: &Path,
        analysis: &Analysis,
        cancel: &CancellationToken,
    ) -> Result<(DerivedBlob, Package), Error> {
        let names: Vec<String> = Self::json(&dir.join("package-files.json")).await?;
        if names.len() > 10000 {
            return Err(Error::Processing("extraction_limit"));
        }
        let folder = tokio::fs::canonicalize(dir.join("template"))
            .await
            .map_err(|_| Error::Storage)?;
        let mut files = Vec::new();
        let mut total = 0u64;
        for name in names {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            // Validate every path before joining it to the workspace.
            let probe = Package {
                schema_version: 1,
                files: vec![PackageFile {
                    path: name.clone(),
                    sha256: "0".repeat(64),
                    size: 1,
                }],
            };
            probe
                .validate()
                .map_err(|_| Error::Processing("invalid_package"))?;
            let path = folder.join(&name);
            let real = tokio::fs::canonicalize(&path)
                .await
                .map_err(|_| Error::Storage)?;
            let metadata = tokio::fs::symlink_metadata(&path)
                .await
                .map_err(|_| Error::Storage)?;
            if !real.starts_with(&folder)
                || !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > 96 * 1024 * 1024
            {
                return Err(Error::Processing("invalid_package"));
            }
            total = total.checked_add(metadata.len()).ok_or(Error::Storage)?;
            if total > 96 * 1024 * 1024 {
                return Err(Error::Processing("extraction_limit"));
            }
            let bytes = tokio::fs::read(path).await.map_err(|_| Error::Storage)?;
            let size = bytes.len() as u64;
            let hash = if bytes.is_empty() {
                hex::encode(Sha256::digest([]))
            } else {
                self.assets
                    .publish(bytes, DerivedFormat::Binary)
                    .await
                    .map_err(|_| Error::Storage)?
                    .sha256
            };
            files.push(PackageFile {
                path: name,
                sha256: hash,
                size,
            });
        }
        // Previews are package members too: no second copy in a permanent archive.
        for p in &analysis.previews {
            files.push(PackageFile {
                path: format!("previews/{}.png", p.ordinal),
                sha256: p.sha256.clone(),
                size: p.size,
            });
        }
        let preview_bytes = serde_json::to_vec(&analysis.previews).map_err(|_| Error::Storage)?;
        let blob = self
            .assets
            .publish(preview_bytes, DerivedFormat::Binary)
            .await
            .map_err(|_| Error::Storage)?;
        files.push(PackageFile {
            path: "analysis/previews.json".into(),
            sha256: blob.sha256,
            size: blob.size,
        });
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let package = Package {
            schema_version: 1,
            files,
        };
        package
            .validate()
            .map_err(|_| Error::Processing("invalid_package"))?;
        let bytes = serde_json::to_vec(&package).map_err(|_| Error::Storage)?;
        let blob = self
            .assets
            .publish(bytes, DerivedFormat::Package)
            .await
            .map_err(|_| Error::Storage)?;
        Ok((blob, package))
    }
    pub(super) async fn restore_package(
        &self,
        hash: String,
        dir: &Path,
        analysis: &Analysis,
        cancel: &CancellationToken,
    ) -> Result<(), Error> {
        let package = self
            .assets
            .package(hash)
            .await
            .map_err(|_| Error::Storage)?;
        let folder = dir.join("template");
        tokio::fs::create_dir(&folder)
            .await
            .map_err(|_| Error::Storage)?;
        for f in package.files {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let bytes = if f.size == 0 {
                Vec::new()
            } else {
                self.assets
                    .bytes(f.sha256, f.size)
                    .await
                    .map_err(|_| Error::Storage)?
            };
            if bytes.len() as u64 != f.size {
                return Err(Error::Storage);
            }
            let path = folder.join(f.path);
            tokio::fs::create_dir_all(path.parent().ok_or(Error::Storage)?)
                .await
                .map_err(|_| Error::Storage)?;
            let mut file = tokio::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .await
                .map_err(|_| Error::Storage)?;
            file.write_all(&bytes).await.map_err(|_| Error::Storage)?;
        }
        for p in &analysis.previews {
            tokio::fs::hard_link(
                folder.join(format!("previews/{}.png", p.ordinal)),
                dir.join(format!("preview-{}.png", p.ordinal)),
            )
            .await
            .map_err(|_| Error::Storage)?;
        }
        tokio::fs::write(
            dir.join("previews.json"),
            serde_json::to_vec(&analysis.previews).map_err(|_| Error::Storage)?,
        )
        .await
        .map_err(|_| Error::Storage)?;
        Ok(())
    }
}
