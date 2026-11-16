// Purpose: Read the canonical current source set used by Studio confirmation and outline inputs.
// Pattern: One stable hash rule over immutable file/extraction identities; no writes.
// Usage: SQLite feature adapters check explicit review rather than treating route visits as approval.
// Related: studio.rs, outlines/context.rs, project_source_review_files.
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
pub(super) struct Snapshot {
    pub hash: String,
    pub ready: bool,
    pub review: Option<String>,
    pub files: Vec<(String, Option<String>)>,
}
pub(super) fn read(db: &Connection, project: &str) -> rusqlite::Result<Snapshot> {
    let rows=db.prepare("SELECT v.id,j.extraction_id,j.status FROM source_items i JOIN source_versions v ON v.id=i.current_version_id LEFT JOIN document_jobs j ON j.id=(SELECT id FROM document_jobs WHERE source_version_id=v.id ORDER BY generation DESC LIMIT 1) WHERE i.project_id=? AND i.deleted_at IS NULL AND i.status='active' ORDER BY i.id")?.query_map([project],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?)))?.collect::<Result<Vec<_>,_>>()?;
    let ready = !rows.is_empty()
        && rows.iter().all(|(_, e, s)| {
            e.is_some()
                && s.as_deref().is_some_and(|s| {
                    ["succeeded", "waiting_configuration", "classifying"].contains(&s)
                })
        });
    let files: Vec<_> = rows.into_iter().map(|(v, e, _)| (v, e)).collect();
    let hash =
        hex::encode(Sha256::digest(serde_json::to_vec(&files).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?));
    let review = db
        .query_row(
            "SELECT id FROM project_source_reviews WHERE project_id=? AND snapshot_hash=?",
            [project, &hash],
            |r| r.get(0),
        )
        .optional()?;
    Ok(Snapshot {
        hash,
        ready,
        review,
        files,
    })
}
