// Purpose: Commit template job links to shared native imports through one conditional write owner.
// Pattern: Validate source lineage and lease without copying canonical structure JSON.
// Usage: Template service commits PPT Master results; no content/TOC rows are created.
// Related: modules/templates/, V12__shared_ppt_packages.sql, documents/jobs.rs.
use super::{Queue, Unavailable};
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat},
    templates::*,
};
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
pub(super) struct SqliteTemplates(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"template result commit failed");
    Error::Storage
}
impl Store for SqliteTemplates {
    fn package(&self, job: uuid::Uuid) -> Work<Option<String>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                db.query_row(
                    "SELECT package_sha256 FROM template_import_links WHERE job_id=?",
                    [job.to_string()],
                    |r| r.get(0),
                )
                .optional()
                .map_err(failure)
            })
            .await
        })
    }
    fn commit(&self, input: Input, analysis: Analysis, bundle: DerivedBlob) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                if analysis.schema_version != 1
                    || bundle.format != DerivedFormat::Package
                    || !analysis.manifest.is_object()
                    || !analysis.native_structure.is_object()
                {
                    return Err(Error::Failed);
                }
                let now = crate::modules::documents::now();
                let tx = db.transaction().map_err(failure)?;
                let sql = "SELECT EXISTS(SELECT 1 FROM document_jobs j
                    JOIN template_versions v ON v.id=j.template_version_id
                    JOIN template_items i ON i.id=v.item_id
                    JOIN file_registrations f ON f.id=v.file_registration_id
                    WHERE j.id=? AND j.lease=? AND j.lease_until>?
                    AND j.status='extracting' AND i.deleted_at IS NULL AND f.blob_sha256=?)";
                let valid: bool = tx
                    .query_row(
                        sql,
                        params![
                            input.job_id.to_string(),
                            input.lease,
                            now,
                            input.source_sha256
                        ],
                        |r| r.get(0),
                    )
                    .map_err(failure)?;
                if !valid {
                    return Err(Error::Cancelled);
                }
                tx.execute(
                    "INSERT INTO template_import_links VALUES(?,?,?,?)",
                    params![
                        input.job_id.to_string(),
                        input.source_sha256,
                        input.profile,
                        bundle.sha256
                    ],
                )
                .map_err(failure)?;
                tx.commit().map_err(failure)?;
                Ok(())
            })
            .await
        })
    }
}
