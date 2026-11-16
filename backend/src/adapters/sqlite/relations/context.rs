// Purpose: Pin source/guide identities and build bounded model context from canonical blocks.
// Pattern: Store references in runs; reconstruct text only when evaluating a search.
// Usage: Search creation, stale-result checks and worker plans.
// Related: retrieval.rs, queries.rs, modules/relations/protocol.rs.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) struct Snapshot {
    pub sources: Vec<(String, String)>,
    pub guide: Option<String>,
    pub hash: String,
}
pub(super) fn project(db: &rusqlite::Connection, id: Uuid, write: bool) -> Result<(), Error> {
    let status: Option<String> = db
        .query_row(
            "SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    let status = status.ok_or(Error::NotFound)?;
    if write && status != "active" {
        return Err(Error::Conflict);
    }
    Ok(())
}
pub(super) fn snapshot(
    db: &rusqlite::Connection,
    id: Uuid,
    ready: bool,
) -> Result<Snapshot, Error> {
    let rows=db.prepare("SELECT v.id,j.extraction_id,j.status FROM source_items i JOIN source_versions v ON v.id=i.current_version_id LEFT JOIN document_jobs j ON j.id=(SELECT id FROM document_jobs WHERE source_version_id=v.id ORDER BY generation DESC LIMIT 1) WHERE i.project_id=? AND i.deleted_at IS NULL AND i.status='active' ORDER BY v.id LIMIT 257").map_err(failure)?.query_map([id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    if rows.len() > 256 {
        return Err(Error::SourceLimit);
    }
    if ready
        && (rows.is_empty()
            || rows.iter().any(|(_, e, s)| {
                e.is_none()
                    || !s.as_deref().is_some_and(|s| {
                        ["succeeded", "waiting_configuration", "classifying"].contains(&s)
                    })
            }))
    {
        return Err(Error::NotReady);
    }
    let guide:Option<String>=db.query_row("SELECT id FROM project_guide_revisions WHERE project_id=? ORDER BY version DESC LIMIT 1",[id.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    let identities: Vec<_> = rows.iter().map(|(v, e, _)| (v, e)).collect();
    let hash = input_hash(&(identities, &guide));
    Ok(Snapshot {
        sources: rows
            .into_iter()
            .filter_map(|(v, e, _)| e.map(|e| (v, e)))
            .collect(),
        guide,
        hash,
    })
}
pub(super) fn text(
    db: &rusqlite::Connection,
    extraction: &str,
    preferred: Option<&str>,
    limit: usize,
) -> Result<String, Error> {
    let mut pieces = Vec::new();
    if let Some(id) = preferred {
        let text:String=db.query_row("SELECT b.text FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE b.id=? AND p.extraction_id=?",params![id,extraction],|r|r.get(0)).map_err(failure)?;
        pieces.push(clip_text(&text, limit / 2));
    }
    if pieces.iter().map(String::len).sum::<usize>() < limit {
        let rows=db.prepare("SELECT b.text FROM (SELECT b.id,p.ordinal,b.position FROM document_pages p JOIN content_blocks b ON b.page_id=p.id WHERE p.extraction_id=? AND b.kind!='image' AND (? IS NULL OR b.id!=?) ORDER BY p.ordinal,b.position LIMIT 4) chosen JOIN content_blocks b ON b.id=chosen.id ORDER BY chosen.ordinal,chosen.position").map_err(failure)?.query_map(params![extraction,preferred,preferred],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
        for value in rows {
            pieces.push(clip_text(&value, 500));
        }
    }
    Ok(clip_text(&pieces.join("\n"), limit))
}
pub(super) fn plan(db: &rusqlite::Connection, run: &Run) -> Result<Plan, Error> {
    let ext=db.prepare("SELECT DISTINCT extraction_id FROM relation_sources WHERE run_id=? ORDER BY extraction_id").map_err(failure)?.query_map([run.id.to_string()],|r|r.get::<_,String>(0)).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let guide:Option<(String,String)>=db.query_row("SELECT g.do_text,g.dont_text FROM project_guide_revisions g JOIN relation_runs r ON r.guide_revision_id=g.id WHERE r.id=?",[run.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let mut documents = Vec::new();
    let per = 6000 / ext.len().clamp(1, 16);
    for id in ext.iter().take(16) {
        documents.push(serde_json::json!({"id":id,"text":text(db,id,None,per.min(1500))?}));
    }
    let mut context = serde_json::json!({"query":run.query,"documents":documents,"additional_document_count":ext.len().saturating_sub(16),"direction":guide.map(|(a,b)|serde_json::json!({"do":clip_text(&a,1200),"dont":clip_text(&b,1200)}))});
    let workspace: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM relation_workspaces WHERE run_id=? AND round>0)",
            [run.id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if workspace {
        let peers=db.prepare("SELECT c.extraction_id,b.id,b.text,e.relation FROM relation_workspace_peers e JOIN relation_candidates c ON c.id=e.candidate_id JOIN content_blocks b ON b.id=e.block_id WHERE e.run_id=? ORDER BY e.position").map_err(failure)?.query_map([run.id.to_string()],|r|Ok(serde_json::json!({"document":r.get::<_,String>(0)?,"block":r.get::<_,String>(1)?,"excerpt":clip_text(&r.get::<_,String>(2)?,400),"relation":r.get::<_,i64>(3)?}))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
        context["workspace_evidence"] = serde_json::json!(peers);
    }
    let ids=db.prepare("SELECT id,extraction_id,block_id,excerpt_block_id,kind FROM relation_candidates WHERE run_id=? AND assessment_key IS NULL ORDER BY ordinal").map_err(failure)?.query_map([run.id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let mut candidates = Vec::new();
    for (id, extraction, block, excerpt, kind) in ids {
        let content = if kind == "file" {
            text(db, &extraction, Some(&excerpt), 1800)?
        } else {
            let v: String = db
                .query_row(
                    "SELECT text FROM content_blocks WHERE id=?",
                    [&excerpt],
                    |r| r.get(0),
                )
                .map_err(failure)?;
            clip_text(&v, 1800)
        };
        let (read_ids, window) = reads::window(db, &id)?;
        candidates.push(Candidate {
            id: uuid(id)?,
            extraction,
            block,
            text: if read_ids.is_empty() { content } else { window },
            read_ids,
            kind,
        });
    }
    Ok(Plan {
        context,
        candidates,
    })
}
