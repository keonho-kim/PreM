// Purpose: Implement the document-owned persistence boundary using the existing SQLite writer.
// Pattern: Async library calls wrap short synchronous transactions, never external work.
// Usage: App wires this store to Documents and its common-engine driver.
// Related: queries.rs, jobs.rs, results.rs, modules/documents/ports.rs.
mod alignment;
mod execution;
mod jobs;
mod materials;
mod queries;
mod results;
mod source_outline;
use super::{Queue, Unavailable};
use crate::modules::documents::*;
use rusqlite::params;
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteDocuments(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"document storage operation failed");
    Error::Storage
}
impl Store for SqliteDocuments {
    fn alignment_checkpoints(
        &self,
        job: Uuid,
    ) -> Work<std::collections::HashMap<String, serde_json::Value>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| alignment::load(db, job)).await })
    }
    fn save_alignment(
        &self,
        job: Job,
        key: String,
        result: serde_json::Value,
        request: Uuid,
    ) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| alignment::save(db, job, key, result, request))
                .await
        })
    }
    fn publish_alignment(
        &self,
        job: Job,
        entries: Vec<SourceEntry>,
        pages: Vec<(Uuid, PageAlignment)>,
    ) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| alignment::publish(db, job, entries, pages))
                .await
        })
    }
    fn current_job(&self, id: Uuid) -> Work<Job> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::get(db, id)).await })
    }
    fn begin_node(&self, j: Job, n: crate::workflows::engine::Node) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::begin(db, j, n)).await })
    }
    fn finish_node(&self, j: Job, n: crate::workflows::engine::Node) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::finish(db, j, n)).await })
    }

    fn enqueue(&self, k: String, i: Uuid, e: i64, key: Uuid, p: ExtractionProfiles) -> Work<Job> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::enqueue(db, k, i, e, key, p)).await })
    }
    fn scan_uploads(&self, p: ExtractionProfiles) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::scan(db, p)).await })
    }
    fn claim(&self) -> Work<Option<Job>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(jobs::claim).await })
    }
    fn heartbeat(&self, id: Uuid, lease: String) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{
 let j=queries::get(db,id)?;if queries::visible(db,&j.kind,j.item_id).is_err(){return Ok(false)}
 Ok(db.execute("UPDATE document_jobs SET lease_until=? WHERE id=? AND lease=? AND lease_until>? AND status IN('extracting','classifying')",params![now()+60_000,id.to_string(),lease,now()]).map_err(failure)?==1)
 }).await
        })
    }
    fn restore_extraction(&self, j: Job) -> Work<Option<Uuid>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| results::cached(db, j)).await })
    }
    fn extraction(&self, j: Job, r: Extracted) -> Work<Uuid> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| results::extraction(db, j, r)).await })
    }
    fn pin(&self, j: Job) -> Work<Job> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::pin(db, j)).await })
    }
    fn blocks(
        &self,
        j: Uuid,
        p: Option<Uuid>,
        pending: bool,
        text: String,
        o: u32,
    ) -> Work<Vec<Block>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| queries::blocks(db, j, p, pending, text, o))
                .await
        })
    }
    fn decisions(&self, j: Job, v: Vec<DecisionCommit>) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| results::decisions(db, j, v)).await })
    }
    fn finish(&self, j: Job, s: String, e: Option<String>, retry: bool) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::finish(db, j, s, e, retry)).await })
    }
    fn detail(&self, k: String, i: Uuid, j: Option<Uuid>) -> Work<Detail> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::detail(db, k, i, j)).await })
    }
    fn history(&self, k: String, i: Uuid) -> Work<Vec<Job>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::history(db, &k, i)).await })
    }
    fn command(&self, id: Uuid, e: i64, key: Uuid, a: String) -> Work<Job> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::command(db, id, e, key, a)).await })
    }
    fn artifact(&self, id: Uuid, hash: String) -> Work<(String, u64)> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{
        use rusqlite::OptionalExtension;
        let j=queries::get(db,id)?;queries::visible(db,&j.kind,j.item_id)?;
        db.query_row("SELECT detected_mime,size_bytes FROM file_blobs b WHERE sha256=?1 AND (EXISTS(SELECT 1 FROM document_pages p WHERE p.extraction_id=?2 AND p.preview_blob_sha256=b.sha256) OR EXISTS(SELECT 1 FROM content_blocks cb JOIN document_pages p ON p.id=cb.page_id WHERE p.extraction_id=?2 AND cb.image_blob_sha256=b.sha256) OR EXISTS(SELECT 1 FROM document_materials m WHERE m.extraction_id=?2 AND m.preview_blob_sha256=b.sha256) OR EXISTS(SELECT 1 FROM document_native_packages n WHERE n.extraction_id=?2 AND n.bundle_blob_sha256=b.sha256) OR EXISTS(SELECT 1 FROM template_import_links l WHERE l.job_id=?3 AND (l.package_sha256=b.sha256 OR EXISTS(SELECT 1 FROM asset_package_members pm WHERE pm.package_sha256=l.package_sha256 AND pm.blob_sha256=b.sha256 AND pm.path GLOB 'previews/*.png'))) OR EXISTS(SELECT 1 FROM template_extractions t WHERE t.id=?3 AND t.bundle_blob_sha256=b.sha256) OR EXISTS(SELECT 1 FROM template_previews p WHERE p.extraction_id=?3 AND p.blob_sha256=b.sha256))",params![hash,j.extraction_id.map(|v|v.to_string()),id.to_string()],|r|Ok((r.get(0)?,r.get::<_,i64>(1)? as u64))).optional().map_err(failure)?.ok_or(Error::NotFound)
    }).await
        })
    }
    fn materials(
        &self,
        id: Uuid,
        page: Option<Uuid>,
        kind: String,
        text: String,
        offset: u32,
        selection: Option<Vec<Uuid>>,
    ) -> Work<MaterialCatalog> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| materials::catalog(db, id, page, kind, text, offset, selection))
                .await
        })
    }
    fn settings(&self) -> Work<Settings> {
        let q = self.0.clone();
        Box::pin(async move { q.call(|db| queries::settings(db)).await })
    }
    fn save_settings(&self, e: i64, c: Option<Uuid>) -> Work<Settings> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::save_settings(db, e, c)).await })
    }
}
pub(super) fn recover(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    execution::recover(db)?;
    db.execute("UPDATE document_jobs SET status=CASE WHEN attempt<3 THEN 'queued' ELSE 'failed' END,error_code='server_restarted',lease=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE status IN('extracting','classifying')",[now()])?;
    Ok(())
}
