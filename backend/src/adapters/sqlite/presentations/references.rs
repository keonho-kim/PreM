// Purpose: Resolve canonical reference material and atomically queue insertion revisions.
// Pattern: IDs and FKs pin lineage; immutable specs are published by the feature outside SQL.
// Usage: Explicit reference insertion and renderer/agent read models.
// Related: V27 migration, modules/presentations/references.rs, execution.rs.
use super::*;
use sha2::{Digest, Sha256};
fn identity(p: Uuid, c: &MaterialChoice) -> Uuid {
    let hash = Sha256::digest(format!("{p}:{}:{}", c.job_id, c.material_id));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 15) | 128;
    bytes[8] = (bytes[8] & 63) | 128;
    Uuid::from_bytes(bytes)
}
pub(super) fn resolve(
    db: &rusqlite::Connection,
    p: Uuid,
    c: &MaterialChoice,
) -> Result<ImportedMaterial, Error> {
    resolve_inner(db, p, c, true)
}
fn resolve_inner(
    db: &rusqlite::Connection,
    p: Uuid,
    c: &MaterialChoice,
    available: bool,
) -> Result<ImportedMaterial, Error> {
    let row=db.query_row("SELECT m.title,m.kind,f.blob_sha256,dp.source_page,m.native_locator_json,m.preview_blob_sha256,coalesce(b.text,(SELECT group_concat(text,' ') FROM content_blocks WHERE page_id=dp.id)) FROM document_jobs j JOIN document_materials m ON m.extraction_id=j.extraction_id JOIN document_pages dp ON dp.id=m.page_id LEFT JOIN content_blocks b ON b.id=m.content_block_id LEFT JOIN reference_versions rv ON rv.id=j.reference_version_id LEFT JOIN reference_items ri ON ri.id=rv.item_id LEFT JOIN source_versions sv ON sv.id=j.source_version_id LEFT JOIN source_items si ON si.id=sv.item_id LEFT JOIN projects sp ON sp.id=si.project_id JOIN file_registrations f ON f.id=coalesce(rv.file_registration_id,sv.file_registration_id) WHERE j.id=? AND m.id=? AND (?3=0 OR (ri.id IS NOT NULL AND ri.deleted_at IS NULL) OR (si.id IS NOT NULL AND si.deleted_at IS NULL AND sp.deleted_at IS NULL))",params![c.job_id.to_string(),c.material_id.to_string(),available],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get::<_,Option<String>>(4)?,r.get(5)?,r.get(6)?))).optional().map_err(failure)?.ok_or(Error::NotFound)?;
    Ok(ImportedMaterial {
        id: identity(p, c),
        job_id: c.job_id,
        material_id: c.material_id,
        title: row.0,
        kind: row.1,
        source_hash: row.2,
        source_page: row.3,
        locator: row
            .4
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(|_| Error::Storage)?,
        preview: row.5,
        text: row.6,
    })
}
pub(super) fn list(db: &rusqlite::Connection, p: Uuid) -> Result<Vec<ImportedMaterial>, Error> {
    preparation::project(db, p, false)?;
    let choices=db.prepare("SELECT job_id,material_id FROM presentation_material_imports WHERE project_id=? ORDER BY id LIMIT 500").map_err(failure)?.query_map([p.to_string()],|r|Ok(MaterialChoice{job_id:uuid(r.get(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?,material_id:uuid(r.get(1)?).map_err(|_|rusqlite::Error::InvalidQuery)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    choices
        .iter()
        .map(|c| resolve_inner(db, p, c, false))
        .collect()
}
fn fingerprint(r: Uuid, i: &InsertMaterials) -> Result<String, Error> {
    serde_json::to_string(&(r, i)).map_err(|_| Error::Storage)
}
fn replay(
    db: &rusqlite::Connection,
    p: Uuid,
    r: Uuid,
    k: Uuid,
    i: &InsertMaterials,
) -> Result<Option<Run>, Error> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT id,fingerprint FROM presentation_runs WHERE request_key=?",
            [k.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    row.map(|(id, f)| {
        if f != fingerprint(r, i)? {
            return Err(Error::Idempotency);
        }
        queries::run(db, p, &id)
    })
    .transpose()
}
fn current(
    db: &rusqlite::Connection,
    p: Uuid,
    r: Uuid,
    i: &InsertMaterials,
) -> Result<String, Error> {
    preparation::project(db, p, true)?;
    db.query_row("SELECT s.spec_sha256 FROM presentation_runs r JOIN presentations d ON d.id=r.presentation_id JOIN presentation_run_slides x ON x.run_id=r.id JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE r.id=? AND r.project_id=? AND s.id=? AND r.status='succeeded' AND d.current_revision_id=r.id AND d.version=?",params![r.to_string(),p.to_string(),i.slide_id.to_string(),i.expected_version],|r|r.get(0)).optional().map_err(failure)?.ok_or(Error::Conflict)
}
pub(super) fn plan(
    db: &rusqlite::Connection,
    p: Uuid,
    r: Uuid,
    k: Uuid,
    i: &InsertMaterials,
) -> Result<InsertionPlan, Error> {
    if let Some(run) = replay(db, p, r, k, i)? {
        return Ok(InsertionPlan::Replayed(Box::new(run)));
    }
    let spec_hash = current(db, p, r, i)?;
    let mut seen = std::collections::HashSet::new();
    let mut items = vec![];
    for choice in &i.items {
        if !seen.insert((choice.job_id, choice.material_id)) {
            return Err(Error::EditInvalid);
        }
        items.push(resolve(db, p, choice)?);
    }
    Ok(InsertionPlan::Build { spec_hash, items })
}
pub(super) fn commit(db: &mut rusqlite::Connection, commit: InsertionCommit) -> Result<Run, Error> {
    let InsertionCommit {
        project_id: p,
        base_run: r,
        key,
        input: i,
        items,
        specs,
        profile,
    } = commit;
    let tx = db.transaction().map_err(failure)?;
    if let Some(run) = replay(&tx, p, r, key, &i)? {
        return Ok(run);
    }
    current(&tx, p, r, &i)?;
    let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM presentation_runs WHERE project_id=? AND status IN('queued','running')) OR (SELECT count(*) FROM presentation_runs WHERE status IN('queued','running'))>=20",[p.to_string()],|r|r.get(0)).map_err(failure)?;
    if busy {
        return Err(Error::Busy);
    }
    for item in &items {
        let fresh = resolve(
            &tx,
            p,
            &MaterialChoice {
                job_id: item.job_id,
                material_id: item.material_id,
            },
        )?;
        if fresh.id != item.id {
            return Err(Error::Conflict);
        }
        register(&tx, p, item)?;
    }
    let rows=tx.prepare("SELECT x.slide_version_id,s.node_id,s.slide_key FROM presentation_run_slides x JOIN presentation_slide_versions s ON s.id=x.slide_version_id WHERE x.run_id=? ORDER BY x.position").map_err(failure)?.query_map([r.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let extra = specs.iter().filter(|s| s.whole_slide).count();
    if rows.len() + extra > 24 {
        return Err(Error::EditInvalid);
    }
    let id = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO presentation_runs(id,project_id,presentation_id,request_key,fingerprint,base_version,design_id,config_id,instructions,definition_version,runtime_profile,status,stage,created_at,manual_design_id) SELECT ?,project_id,presentation_id,?,?,?,design_id,config_id,'',1,?,'queued','rendering',?,manual_design_id FROM presentation_runs WHERE id=?",params![id,key.to_string(),fingerprint(r,&i)?,i.expected_version,profile,now(),r.to_string()]).map_err(failure)?;
    let mut position = 0;
    for (old, node, slide_key) in rows {
        position += 1;
        let changed = if old == i.slide_id.to_string() {
            specs.iter().find(|s| !s.whole_slide)
        } else {
            None
        };
        let slide = if let Some(spec) = changed {
            new_slide(
                &tx,
                &id,
                position,
                node.clone(),
                &slide_key,
                spec,
                Some(&old),
            )?
        } else {
            old.clone()
        };
        tx.execute(
            "INSERT INTO presentation_run_slides VALUES(?,?,?)",
            params![id, slide, position],
        )
        .map_err(failure)?;
        if old == i.slide_id.to_string() {
            for spec in specs.iter().filter(|s| s.whole_slide) {
                position += 1;
                let slide = new_slide(
                    &tx,
                    &id,
                    position,
                    node.clone(),
                    &Uuid::new_v4().to_string(),
                    spec,
                    None,
                )?;
                tx.execute(
                    "INSERT INTO presentation_run_slides VALUES(?,?,?)",
                    params![id, slide, position],
                )
                .map_err(failure)?;
            }
        }
    }
    if let Some(session) = i.session {
        let deck: String = tx
            .query_row(
                "SELECT presentation_id FROM presentation_runs WHERE id=?",
                [&id],
                |r| r.get(0),
            )
            .map_err(failure)?;
        sessions::require(&tx, p, &deck, session)?;
        tx.execute(
            "INSERT INTO presentation_run_sessions VALUES(?,?)",
            params![id, session.to_string()],
        )
        .map_err(failure)?;
    }
    canvas::track(&tx, &id, &r.to_string(), "references")?;
    execution::attach(&tx, &id)?;
    let result = queries::run(&tx, p, &id)?;
    tx.commit().map_err(failure)?;
    Ok(result)
}
pub(super) fn new_slide(
    db: &rusqlite::Connection,
    run: &str,
    pos: i64,
    node: Option<String>,
    key: &str,
    spec: &InsertedSpec,
    old: Option<&str>,
) -> Result<String, Error> {
    plans::blob(db, &spec.blob, "application/json", "json")?;
    let slide = Uuid::new_v4().to_string();
    db.execute("INSERT INTO presentation_slide_versions(id,run_id,position,node_id,spec_sha256,slide_key) VALUES(?,?,?,?,?,?)",params![slide,run,pos,node,spec.blob.sha256,key]).map_err(failure)?;
    if let Some(old) = old {
        db.execute("INSERT INTO presentation_slide_evidence SELECT ?,block_id FROM presentation_slide_evidence WHERE slide_version_id=?",params![slide,old]).map_err(failure)?;
        db.execute("INSERT INTO presentation_slide_media SELECT ?,media_id FROM presentation_slide_media WHERE slide_version_id=?",params![slide,old]).map_err(failure)?;
        db.execute("INSERT INTO presentation_slide_imports SELECT ?,import_id FROM presentation_slide_imports WHERE slide_version_id=?",params![slide,old]).map_err(failure)?;
    }
    for reference in &spec.reference_ids {
        db.execute(
            "INSERT OR IGNORE INTO presentation_slide_imports VALUES(?,?)",
            params![slide, reference.to_string()],
        )
        .map_err(failure)?;
    }
    Ok(slide)
}

pub(super) fn discover(db: &rusqlite::Connection, p: Uuid, prompt: &str) -> Result<(), Error> {
    let words: Vec<_> = prompt
        .split_whitespace()
        .filter(|s| s.chars().count() > 1)
        .take(8)
        .collect();
    let words = serde_json::to_string(&words).map_err(|_| Error::Storage)?;
    let choices=db.prepare("SELECT j.id,m.id FROM reference_items ri JOIN reference_versions rv ON rv.item_id=ri.id JOIN document_jobs j ON j.reference_version_id=rv.id JOIN document_materials m ON m.extraction_id=j.extraction_id WHERE ri.deleted_at IS NULL AND ri.status='active' AND rv.number=(SELECT max(number) FROM reference_versions WHERE item_id=ri.id) AND EXISTS(SELECT 1 FROM json_each(?1) w WHERE instr(lower(m.title),lower(w.value))>0 OR instr(lower(ri.title),lower(w.value))>0 OR (m.kind='chart' AND instr(?2,'차트')>0) OR (m.kind='image' AND instr(?2,'이미지')>0)) ORDER BY rv.created_at DESC,m.source_order LIMIT 8").map_err(failure)?.query_map(params![words,prompt],|r|Ok(MaterialChoice{job_id:uuid(r.get(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?,material_id:uuid(r.get(1)?).map_err(|_|rusqlite::Error::InvalidQuery)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for c in choices {
        db.execute("INSERT OR IGNORE INTO presentation_material_imports SELECT ?1,?2,?3,?4 WHERE (SELECT count(*) FROM presentation_material_imports WHERE project_id=?2)<500",params![identity(p,&c).to_string(),p.to_string(),c.job_id.to_string(),c.material_id.to_string()]).map_err(failure)?;
    }
    Ok(())
}

pub(super) fn sources(
    db: &rusqlite::Connection,
    p: Uuid,
    r: Uuid,
    s: Uuid,
) -> Result<Vec<MaterialSource>, Error> {
    queries::run(db, p, &r.to_string())?;
    db.prepare("SELECT i.id,i.job_id,coalesce(rv.item_id,sv.item_id),CASE WHEN rv.id IS NOT NULL THEN 'references' ELSE 'project-'||si.project_id END,m.title,m.kind,m.preview_blob_sha256,CASE WHEN rv.id IS NOT NULL THEN ri.deleted_at IS NULL ELSE si.deleted_at IS NULL AND sp.deleted_at IS NULL END,coalesce(ri.version,si.version),coalesce(rv.number,sv.number),m.page_id FROM presentation_run_slides x JOIN presentation_slide_imports l ON l.slide_version_id=x.slide_version_id JOIN presentation_material_imports i ON i.id=l.import_id JOIN document_materials m ON m.id=i.material_id JOIN document_jobs j ON j.id=i.job_id LEFT JOIN reference_versions rv ON rv.id=j.reference_version_id LEFT JOIN reference_items ri ON ri.id=rv.item_id LEFT JOIN source_versions sv ON sv.id=j.source_version_id LEFT JOIN source_items si ON si.id=sv.item_id LEFT JOIN projects sp ON sp.id=si.project_id WHERE x.run_id=? AND x.slide_version_id=? AND i.project_id=? ORDER BY i.id").map_err(failure)?.query_map(params![r.to_string(),s.to_string(),p.to_string()],|r|Ok(MaterialSource{item_version:r.get(8)?,file_version:r.get(9)?,page_id:Uuid::parse_str(&r.get::<_,String>(10)?).map_err(|_|rusqlite::Error::InvalidQuery)?,id:Uuid::parse_str(&r.get::<_,String>(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?,job_id:Uuid::parse_str(&r.get::<_,String>(1)?).map_err(|_|rusqlite::Error::InvalidQuery)?,item_id:Uuid::parse_str(&r.get::<_,String>(2)?).map_err(|_|rusqlite::Error::InvalidQuery)?,source_kind:r.get(3)?,title:r.get(4)?,kind:r.get(5)?,preview:r.get(6)?,available:r.get(7)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
}

pub(super) fn register(
    db: &rusqlite::Connection,
    p: Uuid,
    item: &ImportedMaterial,
) -> Result<(), Error> {
    let full:bool=db.query_row("SELECT (SELECT count(*) FROM presentation_material_imports WHERE project_id=?1)>=500 AND NOT EXISTS(SELECT 1 FROM presentation_material_imports WHERE id=?2)",params![p.to_string(),item.id.to_string()],|r|r.get(0)).map_err(failure)?;
    if full {
        return Err(Error::ReferenceLimit);
    }
    db.execute(
        "INSERT OR IGNORE INTO presentation_material_imports VALUES(?,?,?,?)",
        params![
            item.id.to_string(),
            p.to_string(),
            item.job_id.to_string(),
            item.material_id.to_string()
        ],
    )
    .map_err(failure)?;
    Ok(())
}
