// Purpose: Project job lineage, canonical pages and blocks for the document service.
// Pattern: Version-bound joins exclude deleted assets without duplicating source text.
// Usage: Shared by document transactions and HTTP read projections.
// Related: mod.rs, jobs.rs, results.rs.
use super::*;
use rusqlite::{OptionalExtension, Row, params};
const SELECT: &str = "SELECT j.id,CASE WHEN sv.id IS NOT NULL THEN 'project-'||si.project_id WHEN rv.id IS NOT NULL THEN 'references' ELSE 'templates' END,coalesce(rv.item_id,tv.item_id,sv.item_id),coalesce(rv.number,tv.number,sv.number),f.blob_sha256,b.format,j.profile,j.status,j.version,j.attempt,j.lease,j.extraction_id,j.config_id,j.error_code,j.created_at,j.updated_at,(SELECT count(*) FROM content_blocks cb JOIN document_pages dp ON dp.id=cb.page_id WHERE dp.extraction_id=j.extraction_id AND cb.kind!='image'),(SELECT count(*) FROM document_decisions d WHERE d.job_id=j.id) FROM document_jobs j LEFT JOIN reference_versions rv ON rv.id=j.reference_version_id LEFT JOIN template_versions tv ON tv.id=j.template_version_id LEFT JOIN source_versions sv ON sv.id=j.source_version_id LEFT JOIN source_items si ON si.id=sv.item_id JOIN file_registrations f ON f.id=coalesce(rv.file_registration_id,tv.file_registration_id,sv.file_registration_id) JOIN registered_file_facts b ON b.registration_id=f.id";
fn uuid(v: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&v).map_err(|_| rusqlite::Error::InvalidQuery)
}
fn row(r: &Row<'_>) -> rusqlite::Result<Job> {
    Ok(Job {
        id: uuid(r.get(0)?)?,
        kind: r.get(1)?,
        item_id: uuid(r.get(2)?)?,
        file_version: r.get(3)?,
        source_sha256: r.get(4)?,
        format: r.get(5)?,
        profile: r.get(6)?,
        status: r.get(7)?,
        version: r.get(8)?,
        attempt: r.get(9)?,
        lease: r.get(10)?,
        extraction_id: r.get::<_, Option<String>>(11)?.map(uuid).transpose()?,
        config_id: r.get::<_, Option<String>>(12)?.map(uuid).transpose()?,
        error_code: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
        total_blocks: r.get(16)?,
        completed_blocks: r.get(17)?,
        steps: vec![],
    })
}
pub(super) fn get(db: &rusqlite::Connection, id: Uuid) -> Result<Job, Error> {
    let mut job = db
        .query_row(&format!("{SELECT} WHERE j.id=?"), [id.to_string()], row)
        .optional()
        .map_err(failure)?
        .ok_or(Error::NotFound)?;
    job.steps = execution::steps(db, id)?;
    Ok(job)
}
pub(super) fn prefix(kind: &str) -> Result<&'static str, Error> {
    match kind {
        "references" => Ok("reference"),
        "templates" => Ok("template"),
        _ if kind
            .strip_prefix("project-")
            .is_some_and(|id| Uuid::parse_str(id).is_ok()) =>
        {
            Ok("source")
        }
        _ => Err(Error::NotFound),
    }
}
pub(super) fn visible(db: &rusqlite::Connection, kind: &str, item: Uuid) -> Result<(), Error> {
    let p = prefix(kind)?;
    if p == "source" {
        let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM source_items i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND p.id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL)",params![item.to_string(),&kind[8..]],|r|r.get(0)).map_err(failure)?;
        return if valid { Ok(()) } else { Err(Error::NotFound) };
    }
    let exists: bool = db
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {p}_items WHERE id=? AND deleted_at IS NULL)"),
            [item.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if exists { Ok(()) } else { Err(Error::NotFound) }
}
pub(super) fn history(
    db: &rusqlite::Connection,
    kind: &str,
    item: Uuid,
) -> Result<Vec<Job>, Error> {
    visible(db, kind, item)?;
    let p = prefix(kind)?;
    let mut rows:Vec<Job>=db.prepare(&format!("{SELECT} WHERE j.{p}_version_id IN(SELECT id FROM {p}_versions WHERE item_id=?) ORDER BY coalesce(rv.number,tv.number,sv.number) DESC,j.generation DESC,j.id DESC LIMIT 50")).map_err(failure)?.query_map([item.to_string()],row).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for job in &mut rows {
        job.steps = execution::steps(db, job.id)?;
    }
    Ok(rows)
}
pub(super) fn detail(
    db: &rusqlite::Connection,
    kind: String,
    item: Uuid,
    id: Option<Uuid>,
) -> Result<Detail, Error> {
    visible(db, &kind, item)?;
    let job = if let Some(id) = id {
        get(db, id)?
    } else {
        let p = prefix(&kind)?;
        db.query_row(&format!("{SELECT} WHERE j.{p}_version_id=(SELECT current_version_id FROM {p}_items WHERE id=?) ORDER BY coalesce(rv.number,tv.number,sv.number) DESC,j.generation DESC,j.id DESC LIMIT 1"),[item.to_string()],row).optional().map_err(failure)?.ok_or(Error::NotFound)?
    };
    if job.kind != kind || job.item_id != item {
        return Err(Error::NotFound);
    }
    let mut job = job;
    job.steps = execution::steps(db, job.id)?;
    let (page_mode, warnings) = if let Some(id) = job.extraction_id {
        db.query_row(
            "SELECT page_mode,warnings_json FROM document_extractions WHERE id=?",
            [id.to_string()],
            |r| Ok((Some(r.get::<_, String>(0)?), r.get::<_, String>(1)?)),
        )
        .map_err(failure)?
    } else {
        (None, "[]".into())
    };
    let mut pages=db.prepare("SELECT p.id,p.ordinal,p.source_page,p.label,p.preview_blob_sha256,(SELECT count(*) FROM content_blocks b WHERE b.page_id=p.id) FROM document_pages p WHERE p.extraction_id=? ORDER BY ordinal").map_err(failure)?.query_map([job.extraction_id.map(|i|i.to_string())],|r|Ok(Page{alignment:None,id:uuid(r.get(0)?)?,ordinal:r.get(1)?,source_page:r.get(2)?,label:r.get(3)?,preview:r.get(4)?,block_count:r.get(5)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    alignment::attach(db, job.id, &mut pages)?;
    let template:Option<(String,String,String)>=db.query_row("SELECT manifest_json,native_structure_json,bundle_blob_sha256 FROM template_extractions WHERE id=?",[job.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?;
    let (template, template_bundle) = match template {
        Some((m, n, b)) => (
            Some(crate::modules::templates::Analysis {
                schema_version: 1,
                previews: db.prepare("SELECT p.ordinal,p.width,p.height,p.blob_sha256,b.size_bytes FROM template_previews p JOIN file_blobs b ON b.sha256=p.blob_sha256 WHERE p.extraction_id=? ORDER BY ordinal").map_err(failure)?.query_map([job.id.to_string()], |r|Ok(crate::modules::templates::Preview{ordinal:r.get(0)?,width:r.get(1)?,height:r.get(2)?,sha256:r.get(3)?,size:r.get::<_,i64>(4)? as u64})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?,
                manifest: serde_json::from_str(&m).map_err(|_| Error::Storage)?,
                native_structure: serde_json::from_str(&n).map_err(|_| Error::Storage)?,
            }),
            Some(b),
        ),
        None => (None, None),
    };
    let reuse_ready: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM document_extractions WHERE id=? AND schema_version=2)",
            [job.extraction_id.map(|i| i.to_string())],
            |r| r.get(0),
        )
        .map_err(failure)?;
    Ok(Detail {
        source_outline: source_outline::load(db, job.id)?,
        reuse_ready,
        template,
        template_bundle,
        template_extractable: job.kind == "references" && job.format == "pptx",
        job,
        pages,
        page_mode,
        warnings: serde_json::from_str(&warnings).map_err(|_| Error::Storage)?,
    })
}
pub(super) fn blocks(
    db: &rusqlite::Connection,
    id: Uuid,
    page: Option<Uuid>,
    pending: bool,
    q: String,
    offset: u32,
) -> Result<Vec<Block>, Error> {
    let job = get(db, id)?;
    visible(db, &job.kind, job.item_id)?;
    db.prepare("SELECT b.id,b.page_id,b.position,b.kind,b.text,b.attributes_json,d.value,b.image_blob_sha256 FROM content_blocks b JOIN document_pages p ON p.id=b.page_id LEFT JOIN document_decisions d ON d.block_id=b.id AND d.job_id=?1 WHERE p.extraction_id=?2 AND (?3 IS NULL OR p.id=?3) AND (NOT ?4 OR (d.block_id IS NULL AND b.kind!='image')) AND (?5='' OR b.rowid IN (SELECT rowid FROM content_blocks_fts WHERE content_blocks_fts MATCH ?7) OR instr(lower(b.text),lower(?5))>0) ORDER BY p.ordinal,b.position LIMIT 50 OFFSET ?6").map_err(failure)?.query_map(params![id.to_string(),job.extraction_id.map(|i|i.to_string()),page.map(|i|i.to_string()),pending,q,offset,format!("\"{}\"*",if q.is_empty(){"__empty_query__".to_owned()}else{q.replace('"',"\"\"")})],|r|{let attrs:String=r.get(5)?;Ok(Block{id:uuid(r.get(0)?)?,page_id:uuid(r.get(1)?)?,position:r.get(2)?,kind:r.get(3)?,text:r.get(4)?,attributes:serde_json::from_str(&attrs).map_err(|_|rusqlite::Error::InvalidQuery)?,is_table_of_contents:r.get(6)?,image:r.get(7)?})}).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
}
pub(super) fn settings(db: &rusqlite::Connection) -> Result<Settings, Error> {
    db.query_row(
        "SELECT version,connection_id FROM decision_settings WHERE id=1",
        [],
        |r| {
            Ok(Settings {
                version: r.get(0)?,
                connection_id: r.get::<_, Option<String>>(1)?.map(uuid).transpose()?,
            })
        },
    )
    .map_err(failure)
}
pub(super) fn event(db: &rusqlite::Connection, id: Uuid, status: &str) -> Result<(), Error> {
    db.execute(
        "INSERT INTO document_job_events(job_id,status,created_at) VALUES(?,?,?)",
        params![id.to_string(), status, now()],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn active(db: &rusqlite::Connection, job: &Job) -> Result<(), Error> {
    let current = get(db, job.id)?;
    visible(db, &current.kind, current.item_id)?;
    let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM document_jobs WHERE id=? AND lease=? AND lease_until>? AND status IN('extracting','classifying'))",params![job.id.to_string(),job.lease,now()],|r|r.get(0)).map_err(failure)?;
    if valid { Ok(()) } else { Err(Error::Cancelled) }
}
