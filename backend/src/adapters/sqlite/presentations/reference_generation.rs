// Purpose: Pin explicit source choices at admission and attach them before first deck rendering.
// Pattern: Preserve the initial model artifact; enrichment and native slide append commit once.
// Usage: Generation write node after all ordinary slide drafts are saved.
// Related: references.rs, presentation_generation_imports, presentation_reference_drafts.
use super::*;
pub(super) fn admit(
    db: &rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    choices: &[MaterialChoice],
) -> Result<(), Error> {
    let mut seen = std::collections::HashSet::new();
    let mut extra = 0;
    for choice in choices {
        if !seen.insert((choice.job_id, choice.material_id)) {
            return Err(Error::EditInvalid);
        }
        let item = references::resolve(db, p, choice)?;
        extra += i64::from(["slide", "page"].contains(&item.kind.as_str()));
        references::register(db, p, &item)?;
        db.execute(
            "INSERT INTO presentation_generation_imports VALUES(?,?)",
            params![run.to_string(), item.id.to_string()],
        )
        .map_err(failure)?;
    }
    let count: i64 = db
        .query_row(
            "SELECT count(*) FROM presentation_run_slides WHERE run_id=?",
            [run.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if count + extra > 24 {
        return Err(Error::EditInvalid);
    }
    Ok(())
}
pub(super) fn plan(
    db: &rusqlite::Connection,
    r: Run,
) -> Result<Option<(String, Vec<ImportedMaterial>)>, Error> {
    jobs::active(db, &r)?;
    let done:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_reference_drafts WHERE run_id=?) OR NOT EXISTS(SELECT 1 FROM presentation_generation_imports WHERE run_id=?)",params![r.id.to_string(),r.id.to_string()],|r|r.get(0)).map_err(failure)?;
    if done {
        return Ok(None);
    }
    let hash:String=db.query_row("SELECT s.spec_sha256 FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? ORDER BY x.position LIMIT 1",[r.id.to_string()],|r|r.get(0)).map_err(failure)?;
    let ids = db
        .prepare(
            "SELECT import_id FROM presentation_generation_imports WHERE run_id=? ORDER BY rowid",
        )
        .map_err(failure)?
        .query_map([r.id.to_string()], |r| r.get::<_, String>(0))
        .map_err(failure)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    let all = references::list(db, r.project_id)?;
    let items = ids
        .iter()
        .map(|id| {
            all.iter()
                .find(|i| i.id.to_string() == *id)
                .cloned()
                .ok_or(Error::Storage)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some((hash, items)))
}
pub(super) fn apply(
    db: &mut rusqlite::Connection,
    r: Run,
    specs: Vec<InsertedSpec>,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    if tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM presentation_reference_drafts WHERE run_id=?)",
            [r.id.to_string()],
            |r| r.get::<_, bool>(0),
        )
        .map_err(failure)?
    {
        return Ok(());
    }
    let(slide,node,key,base):(String,Option<String>,String,String)=tx.query_row("SELECT s.id,s.node_id,s.slide_key,s.spec_sha256 FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? ORDER BY x.position LIMIT 1",[r.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(failure)?;
    tx.execute(
        "INSERT INTO presentation_reference_drafts VALUES(?,?,?)",
        params![r.id.to_string(), slide, base],
    )
    .map_err(failure)?;
    let mut position: i64 = tx
        .query_row(
            "SELECT count(*) FROM presentation_run_slides WHERE run_id=?",
            [r.id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    for spec in specs {
        plans::blob(&tx, &spec.blob, "application/json", "json")?;
        if spec.whole_slide {
            position += 1;
            let added = references::new_slide(
                &tx,
                &r.id.to_string(),
                position,
                node.clone(),
                &Uuid::new_v4().to_string(),
                &spec,
                None,
            )?;
            tx.execute(
                "INSERT INTO presentation_run_slides VALUES(?,?,?)",
                params![r.id.to_string(), added, position],
            )
            .map_err(failure)?;
        } else {
            tx.execute("UPDATE presentation_slide_versions SET spec_sha256=? WHERE id=? AND run_id=? AND slide_key=?",params![spec.blob.sha256,slide,r.id.to_string(),key]).map_err(failure)?;
            for import in &spec.reference_ids {
                tx.execute(
                    "INSERT INTO presentation_slide_imports VALUES(?,?)",
                    params![slide, import.to_string()],
                )
                .map_err(failure)?;
            }
        }
    }
    tx.commit().map_err(failure)?;
    Ok(())
}

pub(super) fn materials(db: &rusqlite::Connection, r: Run) -> Result<Vec<ImportedMaterial>, Error> {
    jobs::active(db, &r)?;
    let ids = db
        .prepare("SELECT import_id FROM presentation_generation_imports WHERE run_id=?")
        .map_err(failure)?
        .query_map([r.id.to_string()], |r| r.get::<_, String>(0))
        .map_err(failure)?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(failure)?;
    Ok(references::list(db, r.project_id)?
        .into_iter()
        .filter(|m| ids.contains(&m.id.to_string()))
        .collect())
}
