// Purpose: Commit deterministic canvas revisions through the presentation's canonical CAS boundary.
// Pattern: Stable slide identities, immutable Specs, replay receipts and shared render-only workflows.
// Usage: CanvasStore calls from direct move/resize/text/slide commands; no inference or SQL outside here.
// Related: modules/presentations/canvas.rs, manual.rs, sessions.rs, V30 migration.
use super::*;
use sha2::{Digest, Sha256};
impl CanvasStore for SqlitePresentations {
    fn canvas_source(&self, p: Uuid, job: Option<Uuid>, run: Option<Uuid>) -> Work<Option<String>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                preparation::project(db, p, false)?;
                if let Some(run) = run {
                    queries::run(db, p, &run.to_string())?;
                    source(db, &run.to_string())
                } else {
                    job.map(|j| preparation::template(db, &j.to_string()))
                        .transpose()
                }
            })
            .await
        })
    }
    fn blank_replay(&self, p: Uuid, key: Uuid, input: BlankPresentation) -> Work<Option<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| manual::replay(db, p, key, &input)).await })
    }
    fn blank(&self, c: BlankCommit) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| manual::create(db, c)).await })
    }
    fn canvas_plan(&self, p: Uuid, run: Uuid, key: Uuid, input: CanvasCommand) -> Work<CanvasPlan> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                if let Some(r) = replay(db, p, run, key, &input)? {
                    return Ok(CanvasPlan::Replayed(Box::new(r)));
                }
                Ok(CanvasPlan::Build {
                    spec_hash: current(db, p, run, &input)?,
                })
            })
            .await
        })
    }
    fn canvas_commit(&self, c: CanvasCommit) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| commit(db, c)).await })
    }
}
fn fingerprint(p: Uuid, base: Uuid, i: &CanvasCommand) -> Result<String, Error> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&(p, base, i)).map_err(|_| Error::Storage)?,
    )))
}
fn replay(
    db: &rusqlite::Connection,
    p: Uuid,
    base: Uuid,
    key: Uuid,
    i: &CanvasCommand,
) -> Result<Option<Run>, Error> {
    preparation::project(db, p, false)?;
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT id,fingerprint FROM presentation_runs WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    row.map(|(id, old)| {
        if old != fingerprint(p, base, i)? {
            return Err(Error::Idempotency);
        }
        queries::run(db, p, &id)
    })
    .transpose()
}
fn current(
    db: &rusqlite::Connection,
    p: Uuid,
    base: Uuid,
    i: &CanvasCommand,
) -> Result<String, Error> {
    preparation::project(db, p, true)?;
    let r = queries::run(db, p, &base.to_string())?;
    if r.status != "succeeded" || !r.is_current || r.presentation_version != i.expected_version {
        return Err(Error::Conflict);
    }
    if let Some(s) = i.session
        && sessions::require(db, p, &r.presentation_id.to_string(), s)? != base.to_string()
    {
        return Err(Error::HistoryUnavailable);
    }
    busy(db, p, &r.presentation_id.to_string())?;
    db.query_row("SELECT s.spec_sha256 FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? AND s.id=?",params![base.to_string(),i.slide_id.to_string()],|r|r.get(0)).optional().map_err(failure)?.ok_or(Error::NotFound)
}
pub(super) fn busy(db: &rusqlite::Connection, p: Uuid, deck: &str) -> Result<(), Error> {
    let busy:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=?1 AND status IN('queued','running')) OR (SELECT count(*) FROM presentation_runs WHERE status IN('queued','running'))>=20 OR EXISTS(SELECT 1 FROM presentation_edits WHERE presentation_id=?2 AND status IN('queued','running','applying'))",params![p.to_string(),deck],|r|r.get(0)).map_err(failure)?;
    if busy { Err(Error::Busy) } else { Ok(()) }
}
pub(super) fn source(db: &rusqlite::Connection, run: &str) -> Result<Option<String>, Error> {
    db.query_row("SELECT f.blob_sha256 FROM presentation_runs r LEFT JOIN presentation_designs d ON d.id=r.design_id LEFT JOIN presentation_manual_designs m ON m.id=r.manual_design_id LEFT JOIN document_jobs j ON j.id=coalesce(d.template_job_id,m.template_job_id) LEFT JOIN template_versions v ON v.id=j.template_version_id LEFT JOIN file_registrations f ON f.id=v.file_registration_id WHERE r.id=?",[run],|r|r.get(0)).map_err(failure)
}
pub(super) fn track(
    db: &rusqlite::Connection,
    run: &str,
    base: &str,
    operation: &str,
) -> Result<(), Error> {
    db.execute(
        "INSERT INTO presentation_canvas_commands VALUES(?,?,?)",
        params![run, base, operation],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn authored(db: &rusqlite::Connection, run: &str) -> Result<bool, Error> {
    db.query_row("SELECT manual_design_id IS NOT NULL OR EXISTS(SELECT 1 FROM presentation_canvas_commands WHERE run_id=r.id) FROM presentation_runs r WHERE r.id=?",[run],|r|r.get(0)).map_err(failure)
}
fn commit(db: &mut rusqlite::Connection, c: CanvasCommit) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    let (p, base, i) = (c.project, c.base, &c.input);
    if let Some(r) = replay(&tx, p, base, c.key, i)? {
        return Ok(r);
    }
    current(&tx, p, base, i)?;
    let mut rows = queries::slides(&tx, p, base)?;
    let at = rows
        .iter()
        .position(|s| s.id == i.slide_id)
        .ok_or(Error::NotFound)?;
    let id = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at,manual_design_id) SELECT ?,project_id,presentation_id,?,?,?,design_id,config_id,'',1,?,'queued','rendering',?,manual_design_id FROM presentation_runs WHERE id=?",params![id,c.key.to_string(),fingerprint(p,base,i)?,i.expected_version,c.profile,now(),base.to_string()]).map_err(failure)?;
    let changed = match &i.operation {
        CanvasOperation::DeleteSlide => {
            if rows.len() < 2 {
                return Err(Error::EditInvalid);
            }
            rows.remove(at);
            None
        }
        CanvasOperation::MoveSlide { position } => {
            if !(1..=rows.len() as i64).contains(position) {
                return Err(Error::EditInvalid);
            }
            let slide = rows.remove(at);
            rows.insert((*position - 1) as usize, slide);
            None
        }
        _ => {
            if matches!(
                i.operation,
                CanvasOperation::AddSlide { .. } | CanvasOperation::DuplicateSlide
            ) && rows.len() >= 24
            {
                return Err(Error::EditInvalid);
            }
            plans::blob(&tx, &c.spec, "application/json", "json")?;
            let fresh = Uuid::new_v4();
            let insert = matches!(
                i.operation,
                CanvasOperation::AddSlide { .. } | CanvasOperation::DuplicateSlide
            );
            let origin = if matches!(i.operation, CanvasOperation::AddSlide { .. }) {
                None
            } else {
                Some(i.slide_id.to_string())
            };
            tx.execute("INSERT INTO presentation_slide_versions(id,run_id,position,node_id,spec_sha256,slide_key) VALUES(?,?,?,(SELECT node_id FROM presentation_slide_versions WHERE id=?),?,?)",params![fresh.to_string(),id,at as i64+1,origin,c.spec.sha256,if insert {fresh.to_string()} else {tx.query_row("SELECT slide_key FROM presentation_slide_versions WHERE id=?",[i.slide_id.to_string()],|r|r.get::<_,String>(0)).map_err(failure)?}]).map_err(failure)?;
            if let Some(old) = origin {
                for (table, column) in [
                    ("presentation_slide_evidence", "block_id"),
                    ("presentation_slide_imports", "import_id"),
                    ("presentation_slide_media", "media_id"),
                ] {
                    tx.execute(&format!("INSERT INTO {table} SELECT ?,{column} FROM {table} WHERE slide_version_id=?"),params![fresh.to_string(),old]).map_err(failure)?;
                }
            }
            for media in &c.media {
                let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_media WHERE id=? AND project_id=?)",params![media.to_string(),p.to_string()],|r|r.get(0)).map_err(failure)?;
                if !valid {
                    return Err(Error::EditInvalid);
                }
                tx.execute(
                    "INSERT OR IGNORE INTO presentation_slide_media VALUES(?,?)",
                    params![fresh.to_string(), media.to_string()],
                )
                .map_err(failure)?;
            }
            let slide = StoredSlide {
                id: fresh,
                position: 0,
                spec: Some(c.spec.sha256.clone()),
                preview: false,
            };
            if insert {
                rows.insert(at + 1, slide)
            } else {
                rows[at] = slide
            }
            Some(fresh)
        }
    };
    let _changed = changed;
    for (n, s) in rows.iter().enumerate() {
        tx.execute(
            "INSERT INTO presentation_run_slides VALUES(?,?,?)",
            params![id, s.id.to_string(), n as i64 + 1],
        )
        .map_err(failure)?;
    }
    let operation = match i.operation {
        CanvasOperation::Geometry { .. } => "geometry",
        CanvasOperation::Insert { .. } => "insert",
        CanvasOperation::Text { .. } => "text",
        CanvasOperation::AddSlide { .. } => "add_slide",
        CanvasOperation::DuplicateSlide => "duplicate_slide",
        CanvasOperation::DeleteSlide => "delete_slide",
        CanvasOperation::MoveSlide { .. } => "move_slide",
    };
    track(&tx, &id, &base.to_string(), operation)?;
    if let Some(s) = i.session {
        tx.execute(
            "INSERT INTO presentation_run_sessions VALUES(?,?)",
            params![id, s.to_string()],
        )
        .map_err(failure)?;
    }
    execution::attach(&tx, &id)?;
    let result = queries::run(&tx, p, &id)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
