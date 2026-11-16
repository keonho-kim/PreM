// Purpose: Search shared library metadata and reference content without copying an index.
// Pattern: Canonical latest registrations joined to one existing FTS5 index and pinned job/page IDs.
// Usage: Global read-only search, twelve rows per page; no workflow or model request is created.
// Related: modules/search/, registered_file_facts, content_blocks_fts.
use super::{Queue, Unavailable};
use crate::modules::search::{Error, Item, Query, Results, Store, Work};
use rusqlite::params;
use std::sync::Arc;
pub(super) struct SqliteSearch(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
impl Store for SqliteSearch {
    fn search(&self, q: Query) -> Work<Results> {
        let queue = self.0.clone();
        Box::pin(async move { queue.call(move |db| find(db, q)).await })
    }
}
const SOURCES: &str = r#"
WITH sources AS (
 SELECT i.id,'references' AS kind,i.title,v.id AS version_id,v.number AS file_version,v.file_registration_id AS registration_id,
 i.updated_at,i.status,
 coalesce((SELECT group_concat(t.name,' ') FROM reference_tag_links l JOIN reference_tags t ON t.id=l.tag_id WHERE l.item_id=i.id),'') AS tags
 FROM reference_items i JOIN reference_versions v ON v.id=i.current_version_id WHERE i.deleted_at IS NULL
 UNION ALL
 SELECT i.id,'templates',i.title,v.id,v.number,v.file_registration_id,i.updated_at,i.status,
 coalesce((SELECT group_concat(t.name,' ') FROM template_tag_links l JOIN template_tags t ON t.id=l.tag_id WHERE l.item_id=i.id),'')
 FROM template_items i JOIN template_versions v ON v.id=i.current_version_id WHERE i.deleted_at IS NULL

), eligible AS MATERIALIZED (
 SELECT s.*,f.original_filename,b.format,j.id AS job_id,j.extraction_id,
 instr(lower(s.title||' '||f.original_filename||' '||s.tags),lower(?1))>0 AS name_match
 FROM sources s JOIN file_registrations f ON f.id=s.registration_id JOIN registered_file_facts b ON b.registration_id=f.id
 LEFT JOIN document_jobs j ON j.id=(SELECT id FROM document_jobs WHERE ((s.kind='references' AND reference_version_id=s.version_id) OR (s.kind='templates' AND template_version_id=s.version_id)) ORDER BY generation DESC LIMIT 1)
 WHERE (?2='all' OR ?2=s.kind)
 AND (?3 OR s.status='active')
), hits AS MATERIALIZED (
 SELECT cb.id,p.id AS page_id,p.extraction_id,p.label,p.preview_blob_sha256,
 snippet(content_blocks_fts,0,'','',' … ',28) AS excerpt,content_blocks_fts.rank AS score
 FROM content_blocks_fts JOIN content_blocks cb ON cb.rowid=content_blocks_fts.rowid JOIN document_pages p ON p.id=cb.page_id
 WHERE content_blocks_fts MATCH ?4 AND p.extraction_id IN(SELECT extraction_id FROM eligible)
), matched AS MATERIALIZED (
 SELECT e.*,h.page_id,h.label,h.preview_blob_sha256,h.excerpt,h.score,h.id IS NOT NULL AS content_match
 FROM eligible e LEFT JOIN hits h ON h.id=(SELECT id FROM hits WHERE extraction_id=e.extraction_id ORDER BY score,id LIMIT 1)
 WHERE (?5='all' AND (e.name_match OR h.id IS NOT NULL)) OR (?5='files' AND e.name_match) OR (?5='content' AND h.id IS NOT NULL)
)
"#;
fn find(db: &mut rusqlite::Connection, q: Query) -> Result<Results, Error> {
    let terms =
        q.q.split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .take(8)
            .map(|s| format!("\"{}\"*", s.replace('"', "\"\"")))
            .collect::<Vec<_>>();
    let fts = if terms.is_empty() {
        "\"__no_search_terms__\"".into()
    } else {
        terms.join(" OR ")
    };
    let tx = db.transaction().map_err(|_| Error::Storage)?;
    let total = tx
        .query_row(
            &format!("{SOURCES} SELECT count(*) FROM matched"),
            params![q.q, q.scope, q.archived, fts, q.mode],
            |r| r.get(0),
        )
        .map_err(|_| Error::Storage)?;
    let sql = format!(
        "{SOURCES} SELECT id,kind,title,original_filename,format,file_version,updated_at,job_id,page_id,label,coalesce(preview_blob_sha256,(SELECT preview_blob_sha256 FROM document_pages WHERE extraction_id=matched.extraction_id AND preview_blob_sha256 IS NOT NULL ORDER BY ordinal LIMIT 1),(SELECT pm.blob_sha256 FROM template_import_links l JOIN asset_package_members pm ON pm.package_sha256=l.package_sha256 WHERE l.job_id=matched.job_id AND pm.path GLOB 'previews/*.png' ORDER BY pm.path LIMIT 1),(SELECT blob_sha256 FROM template_previews WHERE extraction_id=matched.job_id ORDER BY ordinal LIMIT 1)),coalesce(excerpt,''),name_match,content_match FROM matched ORDER BY name_match DESC,score,updated_at DESC,kind,id LIMIT 12 OFFSET ?6"
    );
    let items = tx
        .prepare(&sql)
        .map_err(|_| Error::Storage)?
        .query_map(
            params![q.q, q.scope, q.archived, fts, q.mode, q.offset],
            |r| {
                Ok(Item {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    title: r.get(2)?,
                    filename: r.get(3)?,
                    format: r.get(4)?,
                    file_version: r.get(5)?,
                    updated_at: r.get(6)?,
                    job_id: r.get(7)?,
                    page_id: r.get(8)?,
                    page_label: r.get(9)?,
                    preview: r.get(10)?,
                    excerpt: r.get(11)?,
                    name_match: r.get(12)?,
                    content_match: r.get(13)?,
                })
            },
        )
        .map_err(|_| Error::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Error::Storage)?;
    tx.commit().map_err(|_| Error::Storage)?;
    Ok(Results {
        items,
        total,
        offset: q.offset,
        limit: 12,
    })
}
