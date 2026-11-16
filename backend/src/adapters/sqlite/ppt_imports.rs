// Purpose: Own shared PPT import identities and package-member references.
// Pattern: One atomic commit registers all files before a source/profile cache becomes visible.
// Usage: The process adapter publishes bytes first, then calls this narrow persistence port.
// Related: modules/ppt_imports/, V12__shared_ppt_packages.sql.
use super::{Queue, Unavailable};
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat, PACKAGE_MIME, Package},
    ppt_imports::{Error, Store, Work},
};
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
pub(super) struct SqliteImports(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"PPT import storage failed");
    Error::Storage
}
impl Store for SqliteImports {
    fn find(&self, source: String, profile: String) -> Work<Option<DerivedBlob>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                let sql = "SELECT b.sha256,b.size_bytes FROM ppt_imports i
                    JOIN file_blobs b ON b.sha256=i.package_sha256
                    WHERE source_sha256=? AND profile=?";
                db.query_row(sql, params![source, profile], |r| {
                    Ok(DerivedBlob {
                        sha256: r.get(0)?,
                        size: r.get::<_, i64>(1)? as u64,
                        format: DerivedFormat::Package,
                    })
                })
                .optional()
                .map_err(failure)
            })
            .await
        })
    }
    fn commit(
        &self,
        source: String,
        profile: String,
        blob: DerivedBlob,
        package: Package,
    ) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                package.validate().map_err(|_| Error::Storage)?;
                if blob.format != DerivedFormat::Package {
                    return Err(Error::Storage);
                }
                let encoded = serde_json::to_vec(&package).map_err(|_| Error::Storage)?;
                use sha2::{Digest, Sha256};
                if hex::encode(Sha256::digest(&encoded)) != blob.sha256
                    || encoded.len() as u64 != blob.size
                {
                    return Err(Error::Storage);
                }
                let tx = db.transaction().map_err(failure)?;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                tx.execute(
                    "INSERT OR IGNORE INTO file_blobs VALUES(?,?,?,'package',?)",
                    params![blob.sha256, blob.size as i64, PACKAGE_MIME, now],
                )
                .map_err(failure)?;
                for f in package.files {
                    if f.size == 0 {
                        continue;
                    }
                    let (mime, format) = if f.path.ends_with(".png") {
                        ("image/png", "png")
                    } else {
                        ("application/octet-stream", "bin")
                    };
                    tx.execute(
                        "INSERT OR IGNORE INTO file_blobs VALUES(?,?,?,?,?)",
                        params![f.sha256, f.size as i64, mime, format, now],
                    )
                    .map_err(failure)?;
                    tx.execute(
                        "INSERT OR IGNORE INTO asset_package_members VALUES(?,?,?)",
                        params![blob.sha256, f.path, f.sha256],
                    )
                    .map_err(failure)?;
                }
                tx.execute(
                    "INSERT INTO ppt_imports VALUES(?,?,?,?)",
                    params![source, profile, blob.sha256, now],
                )
                .map_err(failure)?;
                tx.commit().map_err(failure)
            })
            .await
        })
    }
}
