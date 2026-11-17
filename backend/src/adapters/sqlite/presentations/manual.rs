// Purpose: Create genuinely blank template decks without inventing evidence or provider records.
// Pattern: Immutable manual design pin, nullable model input and ordinary durable render/publication.
// Usage: Explicit blank presentation command with stable replay identity.
// Related: canvas.rs, V30 migration, modules/presentations/canvas.rs.
use super::*;
use sha2::{Digest, Sha256};
fn fingerprint(p: Uuid, i: &BlankPresentation) -> Result<String, Error> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&(p, i)).map_err(|_| Error::Storage)?,
    )))
}
pub(super) fn replay(
    db: &rusqlite::Connection,
    p: Uuid,
    k: Uuid,
    i: &BlankPresentation,
) -> Result<Option<Run>, Error> {
    preparation::project(db, p, false)?;
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT id,fingerprint FROM presentation_runs WHERE request_key=?",
            [k.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    row.map(|(id, old)| {
        if old != fingerprint(p, i)? {
            return Err(Error::Idempotency);
        }
        queries::run(db, p, &id)
    })
    .transpose()
}
pub(super) fn create(db: &mut rusqlite::Connection, c: BlankCommit) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    if let Some(r) = replay(&tx, c.project, c.key, &c.input)? {
        return Ok(r);
    }
    preparation::project(&tx, c.project, true)?;
    canvas::busy(&tx, c.project, "")?;
    if let Some(j) = c.input.template_job_id {
        preparation::template(&tx, &j.to_string())?;
    }
    plans::blob(&tx, &c.spec, "application/json", "json")?;
    let (deck, design, run, slide) = (
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
    );
    tx.execute(
        "INSERT INTO presentations(id,project_id,title,created_at) VALUES(?,?,?,?)",
        params![deck, c.project.to_string(), c.input.title, now()],
    )
    .map_err(failure)?;
    tx.execute(
        "INSERT INTO presentation_manual_designs VALUES(?,?,?,?)",
        params![
            design,
            c.project.to_string(),
            c.input.template_job_id.map(|j| j.to_string()),
            now()
        ],
    )
    .map_err(failure)?;
    tx.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at,manual_design_id) VALUES(?,?,?,?,?,0,NULL,NULL,'',1,?,'queued','rendering',?,?)",params![run,c.project.to_string(),deck,c.key.to_string(),fingerprint(c.project,&c.input)?,c.profile,now(),design]).map_err(failure)?;
    tx.execute(
        "INSERT INTO presentation_slide_versions(id,run_id,position,spec_sha256) VALUES(?,?,1,?)",
        params![slide, run, c.spec.sha256],
    )
    .map_err(failure)?;
    tx.execute(
        "INSERT INTO presentation_run_slides VALUES(?,?,1)",
        params![run, slide],
    )
    .map_err(failure)?;
    execution::attach(&tx, &run)?;
    let result = queries::run(&tx, c.project, &run)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
