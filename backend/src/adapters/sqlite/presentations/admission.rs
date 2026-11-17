// Purpose: Admit explicit generation with fixed reviewed inputs, model and runtime versions.
// Pattern: Idempotent create plus optimistic revision checks in one short transaction.
// Usage: Presentation create/regenerate; template/evidence saves never invoke generation.
// Related: jobs.rs, preparation.rs, model_registry/.
use super::*;
pub(super) fn create(
    db: &mut rusqlite::Connection,
    p: Uuid,
    key: Uuid,
    i: Generate,
    profile: String,
) -> Result<Run, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    let fingerprint = serde_json::to_string(&(p, &i)).map_err(|_| Error::Storage)?;
    if let Some((id, old)) = tx
        .query_row(
            "SELECT id,fingerprint FROM presentation_runs WHERE request_key=?",
            [key.to_string()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(failure)?
    {
        if old != fingerprint {
            return Err(Error::Idempotency);
        }
        return queries::run(&tx, p, &id);
    }
    let c = preparation::current(&tx, p)?;
    if !c.ready || c.design_id != Some(i.design_id) {
        return Err(Error::NotReady);
    }
    let scope = scope::pinned(&tx, p, i.design_id)?;
    let nodes = resolve_scope(&scope.sections, i.node_ids.as_deref())?;
    let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=? AND status IN('queued','running')) OR (SELECT count(*) FROM presentation_runs WHERE status IN('queued','running'))>=20",[p.to_string()],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    let config = models::resolve(&tx, p, &i)?;
    let deck = if let Some(id) = i.presentation_id {
        let current: Option<i64> = tx
            .query_row(
                "SELECT version FROM presentations WHERE id=? AND project_id=?",
                params![id.to_string(), p.to_string()],
                |r| r.get(0),
            )
            .optional()
            .map_err(failure)?;
        if current != Some(i.expected_version) {
            return Err(Error::Conflict);
        }
        id
    } else {
        if i.expected_version != 0 {
            return Err(Error::Conflict);
        }
        let id = Uuid::new_v4();
        tx.execute(
            "INSERT INTO presentations(id,project_id,title,created_at) VALUES(?,?,?,?)",
            params![id.to_string(), p.to_string(), i.title, now()],
        )
        .map_err(failure)?;
        id
    };
    let id = Uuid::new_v4();
    tx.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,'queued','writing',?)",params![id.to_string(),p.to_string(),deck.to_string(),key.to_string(),fingerprint,i.expected_version,i.design_id.to_string(),config,i.instructions,profile,now()]).map_err(failure)?;
    for (pos, node) in nodes.iter().enumerate() {
        let slide = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO presentation_slide_versions(id,run_id,position,node_id) VALUES(?,?,?,?)",
            params![slide, id.to_string(), pos as i64 + 1, node.to_string()],
        )
        .map_err(failure)?;
        tx.execute(
            "INSERT INTO presentation_run_slides VALUES(?,?,?)",
            params![id.to_string(), slide, pos as i64 + 1],
        )
        .map_err(failure)?;
    }
    reference_generation::admit(&tx, p, id, &i.materials)?;
    execution::attach(&tx, &id.to_string())?;
    let result = queries::run(&tx, p, &id.to_string())?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
