// Purpose: Pin bounded neighboring source blocks and expose the exact passages used for review.
// Pattern: Immutable IDs and UTF-8 prefix lengths; canonical text remains in content_blocks.
// Usage: Exploration expands ambiguous candidates; model plans and UI read the same window.
// Related: V18__relation_workspaces.sql, context.rs, exploration.rs.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn expand(db: &rusqlite::Connection, run: &Run) -> Result<usize, Error> {
    let candidates=db.prepare("SELECT c.id,c.extraction_id,c.excerpt_block_id,c.assessment_key FROM relation_candidates c JOIN relation_assessments a ON a.cache_key=c.assessment_key WHERE c.run_id=? AND a.relation IN(4,5) ORDER BY c.ordinal LIMIT 12").map_err(failure)?.query_map([run.id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let mut expanded = 0;
    for (id, ext, anchor, key) in candidates {
        let rows=db.prepare("WITH anchor AS (SELECT p.ordinal,b.position,b.id FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE b.id=?2 AND p.extraction_id=?1), before AS (SELECT b.id,b.text,p.ordinal,b.position FROM document_pages p JOIN content_blocks b ON b.page_id=p.id WHERE p.extraction_id=?1 AND b.kind!='image' AND (p.ordinal,b.position,b.id)<(SELECT ordinal,position,id FROM anchor) ORDER BY p.ordinal DESC,b.position DESC,b.id DESC LIMIT 3), after AS (SELECT b.id,b.text,p.ordinal,b.position FROM document_pages p JOIN content_blocks b ON b.page_id=p.id WHERE p.extraction_id=?1 AND b.kind!='image' AND (p.ordinal,b.position,b.id)>(SELECT ordinal,position,id FROM anchor) ORDER BY p.ordinal,b.position,b.id LIMIT 3) SELECT id,text FROM (SELECT * FROM before UNION ALL SELECT b.id,b.text,p.ordinal,b.position FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE b.id=?2 AND p.extraction_id=?1 UNION ALL SELECT * FROM after) ORDER BY ordinal,position,id").map_err(failure)?.query_map(params![ext,anchor],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
        if rows.is_empty() {
            continue;
        }
        db.execute(
            "INSERT INTO relation_review_history(candidate_id,round,assessment_key) VALUES(?,0,?)",
            params![id, key],
        )
        .map_err(failure)?;
        let primary_limit:i64=db.query_row("SELECT coalesce(max(byte_length),0) FROM relation_reads WHERE candidate_id=? AND block_id=?",params![id,anchor],|r|r.get(0)).map_err(failure)?;
        for (position, (block, text)) in rows.iter().enumerate() {
            let len = clip_text(
                text,
                if block == &anchor {
                    primary_limit.max(800) as usize
                } else {
                    400
                },
            )
            .len();
            db.execute(
                "INSERT INTO relation_reads VALUES(?,1,?,?,?)",
                params![id, position as i64, block, len as i64],
            )
            .map_err(failure)?;
        }
        db.execute(
            "UPDATE relation_candidates SET assessment_key=NULL,cache_hit=0,workspace_round=1 WHERE id=?",
            [id],
        )
        .map_err(failure)?;
        expanded += 1;
    }
    Ok(expanded)
}
pub(super) fn window(
    db: &rusqlite::Connection,
    candidate: &str,
) -> Result<(Vec<String>, String), Error> {
    let rows=db.prepare("SELECT b.id,r.byte_length,b.text,p.label FROM relation_reads r JOIN content_blocks b ON b.id=r.block_id JOIN document_pages p ON p.id=b.page_id WHERE r.candidate_id=?1 AND r.round=(SELECT max(round) FROM relation_reads WHERE candidate_id=?1) ORDER BY r.position").map_err(failure)?.query_map([candidate],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let keys = rows
        .iter()
        .map(|(id, len, _, _)| format!("{id}:{len}"))
        .collect();
    let text = rows
        .iter()
        .map(|(_, len, text, page)| format!("[{page}] {}", clip_text(text, *len as usize)))
        .collect::<Vec<_>>()
        .join("\n");
    Ok((keys, text))
}

pub(super) fn initialize(db: &rusqlite::Connection, run: Uuid) -> Result<(), Error> {
    let candidates=db.prepare("SELECT c.id,c.extraction_id,c.excerpt_block_id,c.kind FROM relation_candidates c WHERE c.run_id=? AND NOT EXISTS(SELECT 1 FROM relation_reads WHERE candidate_id=c.id)").map_err(failure)?.query_map([run.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for (id, ext, anchor, kind) in candidates {
        let rows=db.prepare("SELECT b.id,b.text FROM document_pages p JOIN content_blocks b ON b.page_id=p.id WHERE p.extraction_id=?1 AND (b.id=?2 OR (?3='file' AND b.kind!='image')) ORDER BY CASE WHEN b.id=?2 THEN 0 ELSE 1 END,p.ordinal,b.position,b.id LIMIT 5").map_err(failure)?.query_map(params![ext,anchor,kind],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
        let mut remaining = 1800usize;
        for (position, (block, text)) in rows.iter().enumerate() {
            if remaining == 0 {
                break;
            }
            let limit = if kind == "block" {
                1800
            } else if position == 0 {
                900
            } else {
                500
            };
            let length = clip_text(text, remaining.min(limit)).len();
            db.execute(
                "INSERT INTO relation_reads VALUES(?,0,?,?,?)",
                params![id, position as i64, block, length as i64],
            )
            .map_err(failure)?;
            remaining = remaining.saturating_sub(length + 1);
        }
    }
    Ok(())
}
pub(super) fn evidence(
    db: &rusqlite::Connection,
    p: Uuid,
    candidate: Uuid,
) -> Result<Vec<EvidenceRead>, Error> {
    queries::candidate_project(db, p, candidate)?;
    let source = queries::origins(db, candidate, 0, None)?
        .into_iter()
        .next()
        .ok_or(Error::NotFound)?;
    let mut rows=db.prepare("SELECT b.id,dp.id,dp.label,b.text,r.byte_length FROM relation_reads r JOIN content_blocks b ON b.id=r.block_id JOIN document_pages dp ON dp.id=b.page_id WHERE r.candidate_id=?1 AND r.round=(SELECT max(round) FROM relation_reads WHERE candidate_id=?1) ORDER BY r.position LIMIT 7").map_err(failure)?.query_map([candidate.to_string()],|r|read_row(r,source.clone(),false)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    if rows.is_empty() {
        let row=db.query_row("SELECT b.id,p.id,p.label,b.text,800 FROM relation_candidates c JOIN content_blocks b ON b.id=c.excerpt_block_id JOIN document_pages p ON p.id=b.page_id WHERE c.id=?",[candidate.to_string()],|r|read_row(r,source.clone(),false)).optional().map_err(failure)?;
        if let Some(row) = row {
            rows.push(row)
        }
    }
    let peers=db.prepare("SELECT e.candidate_id,e.block_id FROM relation_workspace_peers e JOIN relation_candidates c ON c.id=?1 JOIN content_blocks b ON b.id=e.block_id JOIN document_pages p ON p.id=b.page_id WHERE e.run_id=c.run_id AND c.workspace_round>0 AND p.extraction_id!=c.extraction_id ORDER BY e.position LIMIT 4").map_err(failure)?.query_map([candidate.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for (id, block) in peers {
        if let Some(origin) = queries::origins(db, uuid(id)?, 0, None)?.into_iter().next() {
            let row=db.query_row("SELECT b.id,p.id,p.label,b.text,400 FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE b.id=?",[block],|r|read_row(r,origin.clone(),true)).map_err(failure)?;
            rows.push(row);
        }
    }
    Ok(rows)
}
fn read_row(
    r: &rusqlite::Row<'_>,
    origin: Origin,
    comparison: bool,
) -> rusqlite::Result<EvidenceRead> {
    let text: String = r.get(3)?;
    let limit: i64 = r.get(4)?;
    let excerpt = clip_text(&text, limit as usize);
    Ok(EvidenceRead {
        origin,
        comparison,
        block_id: Uuid::parse_str(&r.get::<_, String>(0)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        page_id: Uuid::parse_str(&r.get::<_, String>(1)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        page_label: r.get(2)?,
        truncated: excerpt.len() < text.len(),
        text: excerpt,
    })
}
