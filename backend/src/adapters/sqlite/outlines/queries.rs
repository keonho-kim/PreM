// Purpose: Read outline history, canonical assigned content and paged source candidates.
// Pattern: Immutable revision joins; source text and previews remain owned by documents.
// Usage: Studio renders drafts and exact-version evidence without copying business text.
// Related: context.rs, revisions.rs, jobs.rs.
use super::*;
pub(super) fn draft(db: &rusqlite::Connection, r: &str) -> Result<Draft, Error> {
    let nodes=db.prepare("SELECT n.node_id,n.parent_node_id,v.title,v.description FROM outline_revision_nodes n JOIN outline_node_versions v ON v.id=n.node_version_id WHERE n.revision_id=? ORDER BY n.position").map_err(failure)?.query_map([r],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get(2)?,r.get(3)?))).map_err(failure)?.map(|r|{let(id,parent,title,description)=r.map_err(failure)?;Ok(Node{id:uuid(id)?,parent_id:parent.map(uuid).transpose()?,title,description})}).collect::<Result<Vec<_>,Error>>()?;
    let assignments=db.prepare("SELECT node_id,block_id FROM outline_assignments WHERE revision_id=? ORDER BY node_id,block_id").map_err(failure)?.query_map([r],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.map(|r|{let(n,b)=r.map_err(failure)?;Ok(Assignment{node_id:uuid(n)?,block_id:uuid(b)?})}).collect::<Result<Vec<_>,Error>>()?;
    Ok(Draft { nodes, assignments })
}
pub(super) fn block(db: &rusqlite::Connection, id: &str, source: &str) -> Result<Block, Error> {
    let value=db.query_row("SELECT b.id,v.id,i.id,v.number,f.original_filename,p.id,p.label,(SELECT id FROM document_jobs WHERE source_version_id=v.id AND extraction_id=p.extraction_id ORDER BY generation DESC LIMIT 1),b.kind,substr(b.text,1,1200),coalesce(b.image_blob_sha256,p.preview_blob_sha256) FROM content_blocks b JOIN document_pages p ON p.id=b.page_id JOIN source_versions v ON v.id=?2 JOIN source_items i ON i.id=v.item_id JOIN file_registrations f ON f.id=v.file_registration_id WHERE b.id=?1",params![id,source],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get::<_,String>(5)?,r.get(6)?,r.get::<_,String>(7)?,r.get(8)?,r.get(9)?,r.get(10)?))).map_err(failure)?;
    Ok(Block {
        id: uuid(value.0)?,
        source_version_id: uuid(value.1)?,
        item_id: uuid(value.2)?,
        file_version: value.3,
        filename: value.4,
        page_id: uuid(value.5)?,
        page_label: value.6,
        job_id: uuid(value.7)?,
        kind: value.8,
        text: value.9,
        preview: value.10,
    })
}
pub(super) fn state(
    db: &mut rusqlite::Connection,
    p: Uuid,
    r: Option<Uuid>,
) -> Result<State, Error> {
    let tx = db.transaction().map_err(failure)?;
    let c = context::current(&tx, p, false)?;
    let (head, latest) = context::head(&tx, p)?;
    let selected = r.map(|id| id.to_string()).or(latest);
    let mut state = State {
        version: head,
        revision_id: None,
        source_snapshot: c.snapshot,
        guide_version: c.guide_version,
        stale: false,
        confirmed: false,
        ready: c.ready,
        draft: Draft {
            nodes: vec![],
            assignments: vec![],
        },
        run: if r.is_none() {
            latest_run(&tx, p)?
        } else {
            None
        },
    };
    if let Some(id) = selected {
        let row:Option<(i64,String,Option<String>)>=tx.query_row("SELECT number,source_review_id,guide_revision_id FROM outline_revisions WHERE id=? AND project_id=?",params![id,p.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(failure)?;
        let (number, review, guide) = row.ok_or(Error::NotFound)?;
        state.version = number;
        state.revision_id = Some(uuid(id.clone())?);
        state.stale = !c.ready || c.review.as_deref() != Some(&review) || c.guide != guide;
        state.confirmed = !state.stale
            && tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM outline_confirmations WHERE revision_id=?)",
                    [&id],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(failure)?;
        state.draft = draft(&tx, &id)?;
    }
    tx.commit().map_err(failure)?;
    Ok(state)
}
pub(super) fn history(db: &mut rusqlite::Connection, p: Uuid) -> Result<Vec<Revision>, Error> {
    context::current(db, p, false)?;
    db.prepare("SELECT id,number,origin,created_at FROM outline_revisions WHERE project_id=? ORDER BY number DESC LIMIT 100").map_err(failure)?.query_map([p.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(failure)?.map(|r|{let(id,number,origin,created_at)=r.map_err(failure)?;Ok(Revision{id:uuid(id)?,number,origin,created_at})}).collect()
}
pub(super) fn blocks(
    db: &mut rusqlite::Connection,
    p: Uuid,
    revision: Option<Uuid>,
    q: String,
    offset: u32,
    ids: Option<Vec<Uuid>>,
) -> Result<Blocks, Error> {
    let tx = db.transaction().map_err(failure)?;
    let c = context::current(&tx, p, false)?;
    let review = if let Some(r) = revision {
        tx.query_row(
            "SELECT source_review_id FROM outline_revisions WHERE id=? AND project_id=?",
            params![r.to_string(), p.to_string()],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(failure)?
        .ok_or(Error::NotFound)?
    } else {
        c.review.ok_or(Error::NotReady)?
    };
    let ids = ids
        .map(|v| serde_json::to_string(&v))
        .transpose()
        .map_err(|_| Error::Storage)?;
    let filter = "FROM project_source_review_files r JOIN document_pages p ON p.extraction_id=r.extraction_id JOIN content_blocks b ON b.page_id=p.id WHERE r.review_id=?1 AND (?2='' OR instr(lower(b.text),lower(?2))>0) AND (?3 IS NULL OR b.id IN(SELECT value FROM json_each(?3)))";
    let total = tx
        .query_row(
            &format!("SELECT count(DISTINCT b.id) {filter}"),
            params![review, q, ids],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let ids=tx.prepare(&format!("SELECT b.id,min(r.source_version_id) {filter} GROUP BY b.id ORDER BY min(r.source_version_id),p.ordinal,b.position,b.id LIMIT 20 OFFSET ?4")).map_err(failure)?.query_map(params![review,q,ids,offset],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let items = ids
        .into_iter()
        .map(|(b, s)| block(&tx, &b, &s))
        .collect::<Result<Vec<_>, _>>()?;
    tx.commit().map_err(failure)?;
    Ok(Blocks {
        items,
        total,
        offset,
    })
}
pub(super) fn run(db: &rusqlite::Connection, p: Uuid, id: &str) -> Result<Run, Error> {
    db.query_row("SELECT id,project_id,kind,status,version,(SELECT count(*) FROM outline_run_batches WHERE run_id=r.id),(SELECT count(*) FROM outline_run_batches WHERE run_id=r.id AND response_json IS NOT NULL),(SELECT count(*) FROM outline_run_blocks WHERE run_id=r.id AND batch>=0),(SELECT count(*) FROM outline_run_blocks WHERE run_id=r.id),error_code,result_revision_id,config_id,lease FROM outline_runs r WHERE id=? AND project_id=?",params![id,p.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get::<_,Option<String>>(10)?,r.get::<_,String>(11)?,r.get(12)?))).optional().map_err(failure)?.ok_or(Error::NotFound).and_then(|v|Ok(Run{id:uuid(v.0)?,project_id:uuid(v.1)?,kind:v.2,status:v.3,version:v.4,total:v.5,completed:v.6,included_blocks:v.7,total_blocks:v.8,error_code:v.9,result_revision_id:v.10.map(uuid).transpose()?,config_id:uuid(v.11)?,lease:v.12,steps:execution::steps(db,uuid(id.to_owned())?)?}))
}
fn latest_run(db: &rusqlite::Connection, p: Uuid) -> Result<Option<Run>, Error> {
    let id:Option<String>=db.query_row("SELECT id FROM outline_runs WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1",[p.to_string()],|r|r.get(0)).optional().map_err(failure)?;
    id.map(|id| run(db, p, &id)).transpose()
}
