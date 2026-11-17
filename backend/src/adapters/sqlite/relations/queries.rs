// Purpose: Project search progress and grouped source provenance without copying document bodies.
// Pattern: Canonical joins, bounded pages and current visibility checks around immutable run inputs.
// Usage: Studio polling, result rows, source-project disclosure and selected-reference lists.
// Related: context.rs, lifecycle.rs, selections.rs.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn get(
    db: &rusqlite::Connection,
    project: Uuid,
    id: Option<Uuid>,
) -> Result<Option<Run>, Error> {
    context::project(db, project, false)?;
    let row=db.query_row("SELECT id,query,options_json,status,version,config_id,lease,error_code,created_at,snapshot_hash,(SELECT count(*) FROM relation_candidates WHERE run_id=r.id),(SELECT count(*) FROM relation_candidates WHERE run_id=r.id AND assessment_key IS NOT NULL),(SELECT coalesce(sum(cache_hit),0) FROM relation_candidates WHERE run_id=r.id) FROM relation_runs r WHERE project_id=?1 AND (?2 IS NULL OR id=?2) ORDER BY created_at DESC,id DESC LIMIT 1",params![project.to_string(),id.map(|v|v.to_string())],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,i64>(8)?,r.get::<_,String>(9)?,r.get::<_,i64>(10)?,r.get::<_,i64>(11)?,r.get::<_,i64>(12)?))).optional().map_err(failure)?;
    let Some((
        id,
        query,
        options,
        status,
        version,
        config,
        lease,
        error_code,
        created_at,
        snapshot,
        total,
        completed,
        cache_hits,
    )) = row
    else {
        return Ok(None);
    };
    let stale = match context::snapshot(db, project, false) {
        Ok(s) => s.hash != snapshot,
        Err(Error::SourceLimit) => true,
        Err(e) => return Err(e),
    };
    Ok(Some(Run {
        steps: execution::steps(db, uuid(id.clone())?)?,
        id: uuid(id.clone())?,
        project_id: project,
        query,
        options: serde_json::from_str(&options).map_err(|_| Error::Storage)?,
        status,
        version,
        config: config.map(uuid).transpose()?,
        lease,
        deadline: db
            .query_row(
                "SELECT deadline_at FROM relation_workspaces WHERE run_id=?",
                [&id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(failure)?
            .flatten(),
        error_code,
        created_at,
        total,
        completed,
        cache_hits,
        stale,
        exploration: exploration::projection(db, uuid(id.clone())?)?,
    }))
}
pub(super) fn active(db: &rusqlite::Connection, run: &Run) -> Result<(), Error> {
    let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM relation_runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='running' AND r.lease=? AND r.lease_until>? AND p.deleted_at IS NULL)",params![run.id.to_string(),run.lease,now()],|r|r.get(0)).map_err(failure)?;
    if valid { Ok(()) } else { Err(Error::Cancelled) }
}
const ORIGINS: &str = "FROM relation_origins o JOIN source_versions v ON v.id=o.source_version_id JOIN source_items i ON i.id=v.item_id JOIN projects p ON p.id=i.project_id JOIN file_registrations f ON f.id=v.file_registration_id WHERE o.candidate_id=?1";
fn origin_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Origin> {
    let id = |i| {
        let s: String = r.get(i)?;
        Uuid::parse_str(&s).map_err(|_| rusqlite::Error::InvalidQuery)
    };
    Ok(Origin {
        source_version_id: id(0)?,
        project_id: id(1)?,
        project_name: r.get(2)?,
        item_id: id(3)?,
        item_version: r.get(4)?,
        file_version: r.get(5)?,
        filename: r.get(6)?,
        job_id: id(7)?,
        available: r.get(8)?,
    })
}
pub(super) fn origins(
    db: &rusqlite::Connection,
    candidate: Uuid,
    offset: u32,
    selected: Option<&str>,
) -> Result<Vec<Origin>, Error> {
    let sql = format!(
        "SELECT v.id,p.id,p.name,i.id,i.version,v.number,f.original_filename,o.job_id,(p.deleted_at IS NULL AND i.deleted_at IS NULL) {ORIGINS} AND ((?2 IS NULL AND p.deleted_at IS NULL AND i.deleted_at IS NULL) OR v.id=?2) ORDER BY v.created_at DESC,p.id,v.id LIMIT 20 OFFSET ?3"
    );
    db.prepare(&sql)
        .map_err(failure)?
        .query_map(params![candidate.to_string(), selected, offset], origin_row)
        .map_err(failure)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)
}
pub(super) fn candidate_project(
    db: &rusqlite::Connection,
    p: Uuid,
    candidate: Uuid,
) -> Result<(), Error> {
    context::project(db, p, false)?;
    let own:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM relation_candidates c JOIN relation_runs r ON r.id=c.run_id WHERE c.id=? AND r.project_id=?)",params![candidate.to_string(),p.to_string()],|r|r.get(0)).map_err(failure)?;
    if own { Ok(()) } else { Err(Error::NotFound) }
}
pub(super) fn selection_key(
    p: Uuid,
    source: &str,
    extraction: &str,
    block: &Option<String>,
) -> String {
    input_hash(&(p, source, extraction, block))
}
struct CandidateRow {
    kind: String,
    extraction: String,
    block: Option<String>,
    text: String,
    label: String,
    preview: Option<String>,
    relation: Option<i64>,
    query: String,
    page: String,
    excerpt_id: String,
}
fn candidate_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CandidateRow> {
    Ok(CandidateRow {
        kind: r.get(0)?,
        extraction: r.get(1)?,
        block: r.get(2)?,
        text: r.get(3)?,
        label: r.get(4)?,
        preview: r.get(5)?,
        relation: r.get(6)?,
        query: r.get(7)?,
        page: r.get(8)?,
        excerpt_id: r.get(9)?,
    })
}
pub(super) fn item(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    selected_origin: Option<&str>,
) -> Result<Option<ResultItem>, Error> {
    let sql = "SELECT c.kind,c.extraction_id,c.block_id,b.text,dp.label,dp.preview_blob_sha256,
        a.relation,r.query,dp.id,c.excerpt_block_id FROM relation_candidates c
        JOIN relation_runs r ON r.id=c.run_id JOIN content_blocks b ON b.id=c.excerpt_block_id
        JOIN document_pages dp ON dp.id=b.page_id
        LEFT JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.id=?";
    let row = db
        .query_row(sql, [id.to_string()], candidate_row)
        .map_err(failure)?;
    let CandidateRow {
        kind,
        extraction: ext,
        block,
        text,
        label,
        preview,
        relation,
        query,
        page,
        excerpt_id,
    } = row;
    let sources = origins(db, id, 0, selected_origin)?;
    let Some(first) = sources.first() else {
        return Ok(None);
    };
    let (origin_count,project_count): (i64,i64) = db
        .query_row(
            &format!("SELECT count(*),count(DISTINCT p.id) {ORIGINS} AND p.deleted_at IS NULL AND i.deleted_at IS NULL"),
            [id.to_string()],
            |r| Ok((r.get(0)?,r.get(1)?)),
        )
        .map_err(failure)?;
    let key = selection_key(p, &first.source_version_id.to_string(), &ext, &block);
    let state: Option<(i64, bool)> = db
        .query_row(
            "SELECT version,active FROM relation_links WHERE id=? AND project_id=?",
            params![key, p.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    let match_query = retrieval::fts_query(&query);
    let snippet = if match_query.is_empty() {
        None
    } else {
        db.query_row("SELECT snippet(content_blocks_fts,0,'','','…',25) FROM content_blocks_fts JOIN content_blocks b ON b.rowid=content_blocks_fts.rowid WHERE b.id=? AND content_blocks_fts MATCH ?",params![excerpt_id,match_query],|r|r.get::<_,String>(0)).optional().map_err(failure)?
    };
    let snippet = snippet.unwrap_or(text);
    let mut excerpt = clip_text(&snippet, 800);
    if excerpt.len() < snippet.len() {
        excerpt.push('…');
    }
    Ok(Some(ResultItem {
        evidence_version: db
            .query_row(
                "SELECT workspace_round FROM relation_candidates WHERE id=?",
                [id.to_string()],
                |r| r.get(0),
            )
            .map_err(failure)?,
        id,
        kind,
        relation,
        excerpt,
        page_label: label,
        page_id: uuid(page)?,
        preview,
        origins: sources,
        origin_count,
        project_count,
        selection_id: key,
        selection_version: state.map_or(0, |v| v.0),
        selected: state.is_some_and(|v| v.1),
    }))
}
pub(super) fn results(
    db: &rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    kind: String,
    offset: u32,
) -> Result<Results, Error> {
    get(db, p, Some(run))?.ok_or(Error::NotFound)?;
    let filter = "FROM relation_candidates c LEFT JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=?1 AND c.kind=?2 AND (a.relation IS NULL OR a.relation!=0) AND EXISTS(SELECT 1 FROM relation_origins o JOIN source_versions v ON v.id=o.source_version_id JOIN source_items i ON i.id=v.item_id JOIN projects p ON p.id=i.project_id WHERE o.candidate_id=c.id AND p.deleted_at IS NULL AND i.deleted_at IS NULL)";
    let total = db
        .query_row(
            &format!("SELECT count(*) {filter}"),
            params![run.to_string(), kind],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let ids=db.prepare(&format!("SELECT c.id {filter} ORDER BY CASE a.relation WHEN 2 THEN 0 WHEN 1 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 ELSE 5 END,c.ordinal LIMIT 12 OFFSET ?3")).map_err(failure)?.query_map(params![run.to_string(),kind,offset],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let mut items = Vec::new();
    for id in ids {
        if let Some(item) = item(db, p, uuid(id)?, None)? {
            items.push(item)
        }
    }
    Ok(Results {
        total,
        items,
        offset,
    })
}
