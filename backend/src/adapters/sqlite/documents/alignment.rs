// Purpose: Store source-alignment checkpoints under the active document lease.
// Pattern: Derive page views only from results for this exact processing job.
// Usage: Document worker and shared project/reference detail projection.
// Related: V1__baseline.sql, modules/documents/alignment/.
use super::*;
use std::collections::HashMap;
pub(super) fn load(
    db: &rusqlite::Connection,
    job: Uuid,
) -> Result<HashMap<String, serde_json::Value>, Error> {
    let mut q = db
        .prepare("SELECT task_key,result_json FROM document_alignment WHERE job_id=?")
        .map_err(failure)?;
    let rows = q
        .query_map([job.to_string()], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(failure)?;
    rows.map(|r| {
        let (k, v) = r.map_err(failure)?;
        Ok((k, serde_json::from_str(&v).map_err(|_| Error::Storage)?))
    })
    .collect()
}
pub(super) fn save(
    db: &mut rusqlite::Connection,
    job: Job,
    key: String,
    result: serde_json::Value,
    request: Uuid,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    {
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM llm_requests WHERE id=? AND provider_config_version_id=? AND status='succeeded')", params![request.to_string(),job.config_id.map(|id|id.to_string())],|r|r.get(0)).map_err(failure)?;
        if !valid {
            return Err(Error::Conflict);
        }
    }
    tx.execute(
        "INSERT INTO document_alignment VALUES(?,?,?,?)",
        params![
            job.id.to_string(),
            key,
            result.to_string(),
            request.to_string()
        ],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)
}
pub(super) fn publish(
    db: &mut rusqlite::Connection,
    job: Job,
    entries: Vec<SourceEntry>,
    pages: Vec<(Uuid, PageAlignment)>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    queries::active(&tx, &job)?;
    source_outline::save(&tx, &job, &entries)?;
    for (page, a) in pages {
        let count=tx.execute("INSERT INTO document_page_alignments(job_id,page_id,role,section,preceding_section,toc_block,toc_line,toc_printed_start,evidence_block,printed_page)
            SELECT j.id,p.id,?3,?4,?5,?6,?7,?8,?9,?10 FROM document_jobs j JOIN document_pages p ON p.extraction_id=j.extraction_id
            WHERE j.id=?1 AND p.id=?2 AND (?6 IS NULL OR EXISTS(SELECT 1 FROM document_source_entries WHERE job_id=j.id AND block_id=?6 AND line=?7 AND parent IS NULL))
            AND (?9 IS NULL OR EXISTS(SELECT 1 FROM content_blocks WHERE id=?9 AND page_id=p.id))",
            params![job.id.to_string(),page.to_string(),a.role,a.section,a.preceding_section,a.toc_block.map(|id|id.to_string()),a.toc_line,a.toc_printed_start,a.evidence_block.map(|id|id.to_string()),a.printed_page]).map_err(failure)?;
        if count != 1 {
            return Err(Error::Conflict);
        }
    }
    tx.commit().map_err(failure)
}
pub(super) fn attach(
    db: &rusqlite::Connection,
    job: Uuid,
    pages: &mut [Page],
) -> Result<(), Error> {
    let mut q=db.prepare("SELECT page_id,role,section,preceding_section,toc_block,toc_line,toc_printed_start,evidence_block,printed_page FROM document_page_alignments WHERE job_id=?").map_err(failure)?;
    let rows = q
        .query_map([job.to_string()], |r| {
            let uuid = |index| -> rusqlite::Result<Option<Uuid>> {
                r.get::<_, Option<String>>(index)?
                    .map(|v| Uuid::parse_str(&v).map_err(|_| rusqlite::Error::InvalidQuery))
                    .transpose()
            };
            Ok((
                r.get::<_, String>(0)?,
                PageAlignment {
                    role: r.get(1)?,
                    section: r.get(2)?,
                    preceding_section: r.get(3)?,
                    toc_block: uuid(4)?,
                    toc_line: r.get(5)?,
                    toc_printed_start: r.get(6)?,
                    evidence_block: uuid(7)?,
                    printed_page: r.get(8)?,
                },
            ))
        })
        .map_err(failure)?;
    let mut results: HashMap<_, _> = rows.collect::<Result<_, _>>().map_err(failure)?;
    for page in pages {
        page.alignment = results.remove(&page.id.to_string());
    }
    Ok(())
}
