// Purpose: Maintain three session-owned prior states and atomically restore immutable deck artifacts.
// Pattern: CAS head changes, scoped idempotency, short transactions and no external work.
// Usage: Publication pushes a prior head; undo consumes a stack entry without pushing itself.
// Related: V22 migration, publish.rs, queries.rs.
use super::*;
fn stack(db: &rusqlite::Connection, deck: &str) -> Result<Vec<String>, Error> {
    db.prepare(
        "SELECT revision_id FROM presentation_undo_stack WHERE session_id=? ORDER BY position",
    )
    .map_err(failure)?
    .query_map([deck], |r| r.get(0))
    .map_err(failure)?
    .collect::<Result<Vec<_>, _>>()
    .map_err(failure)
}
fn save(db: &rusqlite::Connection, deck: &str, ids: Vec<String>) -> Result<(), Error> {
    db.execute(
        "DELETE FROM presentation_undo_stack WHERE session_id=?",
        [deck],
    )
    .map_err(failure)?;
    for (i, id) in ids.into_iter().take(3).enumerate() {
        db.execute(
            "INSERT INTO presentation_undo_stack VALUES(?,?,?)",
            params![deck, (i + 1) as i64, id],
        )
        .map_err(failure)?;
    }
    Ok(())
}
pub(super) fn push(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    sessions::expire(db, false)?;
    let row:Option<(String,String)>=db.query_row("SELECT s.id,s.head_revision_id FROM presentation_run_sessions l JOIN presentation_editor_sessions s ON s.id=l.session_id WHERE l.run_id=? AND s.expires_at>?",params![r.id.to_string(),now()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(failure)?;
    let Some((session, head)) = row else {
        return Ok(());
    };
    let previous: Option<String> = db
        .query_row(
            "SELECT current_revision_id FROM presentations WHERE id=?",
            [r.presentation_id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if let Some(previous) = previous {
        let mut ids = vec![previous.clone()];
        if head == previous {
            ids.extend(stack(db, &session)?);
        }
        save(db, &session, ids)?;
    }
    db.execute(
        "UPDATE presentation_editor_sessions SET head_revision_id=? WHERE id=?",
        params![r.id.to_string(), session],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn read(
    db: &rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    session: Option<Uuid>,
) -> Result<History, Error> {
    let run = queries::run(db, p, &id.to_string())?;
    let before:Option<String>=db.query_row("SELECT COALESCE((SELECT previous_revision_id FROM presentation_restorations WHERE run_id=r.id),(SELECT v.id FROM presentation_revisions v WHERE v.presentation_id=r.presentation_id AND v.number=r.base_version)) FROM presentation_runs r WHERE r.id=? AND r.status='succeeded'",[id.to_string()],|r|r.get(0)).optional().map_err(failure)?.flatten();
    let mut slides = vec![];
    if let Some(b) = &before {
        let rows=db.prepare("SELECT c.slide_version_id,o.slide_version_id FROM presentation_run_slides c JOIN presentation_slide_versions cs ON cs.id=c.slide_version_id JOIN presentation_slide_versions os ON os.slide_key=cs.slide_key JOIN presentation_run_slides o ON o.slide_version_id=os.id AND o.run_id=? WHERE c.run_id=? ORDER BY c.position").map_err(failure)?.query_map(params![b,id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
        for (current, old) in rows {
            slides.push(Comparison {
                slide_id: uuid(current)?,
                before_slide_id: uuid(old)?,
            });
        }
    }
    Ok(History {
        before_run_id: before.map(uuid).transpose()?,
        slides,
        undo_remaining: if let Some(session) = session {
            match sessions::require(db, p, &run.presentation_id.to_string(), session) {
                Ok(head) if run.is_current && head == id.to_string() => {
                    stack(db, &session.to_string())?.len()
                }
                _ => 0,
            }
        } else {
            0
        },
    })
}
pub(super) fn undo(
    db: &mut rusqlite::Connection,
    p: Uuid,
    id: Uuid,
    key: Uuid,
    version: i64,
    session: Uuid,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    if let Some((new,old,v))=tx.query_row("SELECT run_id,previous_revision_id,expected_version FROM presentation_restorations WHERE request_key=?",[key.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?))).optional().map_err(failure)?{
  if old!=id.to_string()||v!=version{return Err(Error::Idempotency)}return queries::run(&tx,p,&new)
 }
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE request_key=?)",
            [key.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if exists {
        return Err(Error::Idempotency);
    }
    let run = queries::run(&tx, p, &id.to_string())?;
    if !run.is_current || run.status != "succeeded" || run.presentation_version != version {
        return Err(Error::Conflict);
    }
    let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=?1 AND status IN('queued','running')) OR EXISTS(SELECT 1 FROM presentation_edits WHERE presentation_id=?2 AND status IN('queued','running'))",params![p.to_string(),run.presentation_id.to_string()],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    let deck = run.presentation_id.to_string();
    sessions::expire(&tx, false)?;
    if sessions::require(&tx, p, &deck, session)? != id.to_string() {
        return Err(Error::HistoryUnavailable);
    }
    let mut ids = stack(&tx, &session.to_string())?;
    if ids.is_empty() {
        return Err(Error::HistoryUnavailable);
    }
    let target = ids.remove(0);
    let new = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at,manual_design_id) SELECT ?,project_id,presentation_id,?,?,?,design_id,config_id,'',definition_version,runtime_profile,'succeeded','complete',?,manual_design_id FROM presentation_runs WHERE id=? AND presentation_id=?",params![new,key.to_string(),format!("undo:{id}:{version}"),version,now(),target,deck]).map_err(failure)?;
    tx.execute("INSERT INTO presentation_revisions SELECT ?,presentation_id,?,output_sha256,? FROM presentation_revisions WHERE id=?",params![new,version+1,now(),target]).map_err(failure)?;
    tx.execute("INSERT INTO presentation_run_slides SELECT ?,slide_version_id,position FROM presentation_run_slides WHERE run_id=?",params![new,target]).map_err(failure)?;
    tx.execute("INSERT INTO presentation_revision_slides SELECT ?,slide_version_id,position FROM presentation_run_slides WHERE run_id=?",params![new,target]).map_err(failure)?;
    tx.execute(
        "INSERT INTO presentation_restorations VALUES(?,?,?,?,?)",
        params![new, target, id.to_string(), key.to_string(), version],
    )
    .map_err(failure)?;
    if tx.execute("UPDATE presentations SET version=version+1,current_revision_id=? WHERE id=? AND version=? AND current_revision_id=?",params![new,deck,version,id.to_string()]).map_err(failure)?!=1{return Err(Error::Conflict)}
    save(&tx, &session.to_string(), ids)?;
    tx.execute(
        "UPDATE presentation_editor_sessions SET head_revision_id=? WHERE id=?",
        params![new, session.to_string()],
    )
    .map_err(failure)?;
    execution::attach(&tx, &new)?;
    tx.execute("INSERT INTO presentation_quality_checks(workflow_id,project_id,style_key,slide_version_id,position,passed,report_json,reused,cache_key) SELECT ?1,project_id,style_key,slide_version_id,position,passed,report_json,1,cache_key FROM presentation_quality_checks WHERE workflow_id=?2",params![new,target]).map_err(failure)?;
    tx.execute(
        "UPDATE workflow_nodes SET state='succeeded' WHERE workflow_id=?",
        [&new],
    )
    .map_err(failure)?;
    let result = queries::run(&tx, p, &new)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
