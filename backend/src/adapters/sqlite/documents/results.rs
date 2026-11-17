// Purpose: Commit immutable normalized extraction and per-batch decision checkpoints.
// Pattern: Content hash/profile reuse; every commit verifies the active job lease.
// Usage: Worker calls these after parsing or inference has completed outside SQLite.
// Related: queries.rs, jobs.rs, modules/documents/.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn cached(db: &mut rusqlite::Connection, job: Job) -> Result<Option<Uuid>, Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    let id: Option<String> = tx
        .query_row(
            "SELECT id FROM document_extractions WHERE source_blob_sha256=? AND profile=?",
            params![job.source_sha256, job.profile],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    if let Some(id) = &id {
        tx.execute(
            "UPDATE document_jobs SET extraction_id=?,updated_at=?,version=version+1 WHERE id=?",
            params![id, now(), job.id.to_string()],
        )
        .map_err(failure)?;
    }
    if id.is_some() {
        execution::extracted(&tx, &job)?;
    }
    tx.commit().map_err(failure)?;
    id.map(|s| Uuid::parse_str(&s).map_err(|_| Error::Storage))
        .transpose()
}
pub(super) fn extraction(
    db: &mut rusqlite::Connection,
    job: Job,
    result: Extracted,
) -> Result<Uuid, Error> {
    validate(&result)?;
    let mut result = result;
    let native = result.native.take();
    if let Some(id) = cached(db, job.clone())? {
        return Ok(id);
    }
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    let id = Uuid::new_v4();
    tx.execute("INSERT INTO document_extractions(id,source_blob_sha256,profile,schema_version,page_mode,warnings_json,created_at) VALUES(?,?,?,?,?,?,?)",params![id.to_string(),job.source_sha256,job.profile,result.schema_version,result.page_mode,serde_json::to_string(&result.warnings).map_err(|_|Error::Storage)?,now()]).map_err(failure)?;
    for file in &result.files {
        tx.execute("INSERT OR IGNORE INTO file_blobs(sha256,size_bytes,detected_mime,format,created_at) VALUES(?,?,'image/png','png',?)",params![file.sha256,file.size as i64,now()]).map_err(failure)?;
    }
    for (ordinal, page) in result.pages.into_iter().enumerate() {
        let page_id = Uuid::new_v4();
        tx.execute("INSERT INTO document_pages(id,extraction_id,ordinal,source_page,label,preview_blob_sha256) VALUES(?,?,?,?,?,?)",params![page_id.to_string(),id.to_string(),ordinal as i64+1,page.source_page,page.label,page.preview]).map_err(failure)?;
        for (position, block) in page.blocks.into_iter().enumerate() {
            tx.execute("INSERT INTO content_blocks(id,page_id,position,kind,text,attributes_json,image_blob_sha256) VALUES(?,?,?,?,?,?,?)",params![Uuid::new_v4().to_string(),page_id.to_string(),position as i64,block.kind,block.text,block.attributes.to_string(),block.attributes.get("image_sha256").and_then(serde_json::Value::as_str)]).map_err(failure)?;
        }
    }
    if result.schema_version == 2 {
        super::materials::index(&tx, id, native)?;
    }
    tx.execute(
        "UPDATE document_jobs SET extraction_id=?,updated_at=?,version=version+1 WHERE id=?",
        params![id.to_string(), now(), job.id.to_string()],
    )
    .map_err(failure)?;
    execution::extracted(&tx, &job)?;
    queries::event(&tx, job.id, "extracted")?;
    tx.commit().map_err(failure)?;
    Ok(id)
}
pub(super) fn decisions(
    db: &mut rusqlite::Connection,
    job: Job,
    values: Vec<DecisionCommit>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    for value in values {
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM content_blocks b JOIN document_pages p ON p.id=b.page_id JOIN document_jobs j ON j.extraction_id=p.extraction_id JOIN llm_requests r ON r.id=? WHERE j.id=? AND b.id=? AND r.provider_config_version_id=j.config_id AND r.status='succeeded')",params![value.request_id.to_string(),job.id.to_string(),value.block_id.to_string()],|r|r.get(0)).map_err(failure)?;
        if !valid || ![0, 1].contains(&value.value) {
            return Err(Error::Conflict);
        }
        tx.execute("INSERT INTO document_decisions(job_id,block_id,predicate,value,statistics_json,request_id) VALUES(?,?,'is_table_of_contents',?,?,?)",params![job.id.to_string(),value.block_id.to_string(),value.value,value.statistics.to_string(),value.request_id.to_string()]).map_err(failure)?;
    }
    tx.execute(
        "UPDATE document_jobs SET updated_at=?,version=version+1 WHERE id=?",
        params![now(), job.id.to_string()],
    )
    .map_err(failure)?;
    queries::event(&tx, job.id, "batch_completed")?;
    tx.commit().map_err(failure)?;
    Ok(())
}
fn validate(r: &Extracted) -> Result<(), Error> {
    let size = serde_json::to_vec(r)
        .map_err(|_| Error::Processing("invalid_extraction"))?
        .len();
    if ![1, 2].contains(&r.schema_version)
        || r.pages.len() > 500
        || size > 16 * 1024 * 1024
        || r.warnings.len() > 1000
        || r.pages.iter().map(|p| p.blocks.len()).sum::<usize>() > 20000
    {
        return Err(Error::Processing("extraction_limit"));
    }
    if !["layout", "section", "unpaginated", "sheet", "slide"].contains(&r.page_mode.as_str()) {
        return Err(Error::Processing("invalid_extraction"));
    }
    let files: std::collections::HashSet<_> = r.files.iter().map(|f| f.sha256.as_str()).collect();
    if r.native.as_ref().is_some_and(|n| {
        n.materials.iter().any(|m| {
            m.preview
                .as_ref()
                .is_some_and(|hash| !files.contains(hash.as_str()))
        })
    }) {
        return Err(Error::Processing("invalid_material_preview"));
    }
    for p in &r.pages {
        if p.source_page.is_some_and(|n| !(1..=10000).contains(&n)) || p.label.len() > 200 {
            return Err(Error::Processing("invalid_extraction"));
        }
        for b in &p.blocks {
            if b.text.is_empty()
                || b.text.len() > 6500
                || !b.attributes.is_object()
                || ![
                    "paragraph",
                    "heading",
                    "table",
                    "list",
                    "code",
                    "image",
                    "separator",
                ]
                .contains(&b.kind.as_str())
            {
                return Err(Error::Processing("invalid_extraction"));
            }
        }
    }
    Ok(())
}
