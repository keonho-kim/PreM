// Purpose: Pin chosen historical source versions and content identities without copying bytes.
// Pattern: Stable selection identities with CAS state changes; historical references remain intact.
// Usage: Studio adds/removes references and reads the project's retained selection list.
// Related: queries.rs, relation_links, source_versions and content_blocks.
use super::*;
use rusqlite::{OptionalExtension, params};
pub(super) fn select(
    db: &mut rusqlite::Connection,
    p: Uuid,
    input: SelectItem,
) -> Result<Selection, Error> {
    let tx = db.transaction().map_err(failure)?;
    context::project(&tx, p, true)?;
    queries::candidate_project(&tx, p, input.candidate_id)?;
    let (run_id, ext, block): (String, String, Option<String>) = tx
        .query_row(
            "SELECT run_id,extraction_id,block_id FROM relation_candidates WHERE id=?",
            [input.candidate_id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(failure)?;
    let key = queries::selection_key(p, &input.source_version_id.to_string(), &ext, &block);
    let old: Option<(i64, bool)> = tx
        .query_row(
            "SELECT version,active FROM relation_links WHERE id=?",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    if old.is_some_and(|(v, active)| v == input.expected_version + 1 && active == input.selected) {
        return Ok(Selection {
            id: key,
            version: input.expected_version + 1,
            active: input.selected,
        });
    }
    if old.map_or(0, |v| v.0) != input.expected_version {
        return Err(Error::Conflict);
    }
    if input.selected {
        let run = queries::get(&tx, p, Some(uuid(run_id)?))?.ok_or(Error::NotFound)?;
        if run.stale {
            return Err(Error::Conflict);
        }
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM relation_origins o JOIN source_versions v ON v.id=o.source_version_id JOIN source_items i ON i.id=v.item_id JOIN projects p ON p.id=i.project_id WHERE o.candidate_id=? AND o.source_version_id=? AND p.deleted_at IS NULL AND i.deleted_at IS NULL)",params![input.candidate_id.to_string(),input.source_version_id.to_string()],|r|r.get(0)).map_err(failure)?;
        if !valid {
            return Err(Error::NotFound);
        }
        let count: i64 = tx
            .query_row(
                "SELECT count(*) FROM relation_links WHERE project_id=? AND active=1",
                [p.to_string()],
                |r| r.get(0),
            )
            .map_err(failure)?;
        if count >= 100 && old.is_none_or(|v| !v.1) {
            return Err(Error::SelectionLimit);
        }
    } else if old.is_none() {
        return Err(Error::NotFound);
    }
    tx.execute("INSERT INTO relation_links VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,candidate_id=excluded.candidate_id,version=version+1,updated_at=excluded.updated_at",params![key,p.to_string(),input.candidate_id.to_string(),input.source_version_id.to_string(),input.selected,now(),now()]).map_err(failure)?;
    tx.execute(
        "INSERT INTO relation_link_changes VALUES(?,?,?,?,?)",
        params![
            key,
            input.expected_version + 1,
            input.candidate_id.to_string(),
            input.selected,
            now()
        ],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(Selection {
        id: key,
        version: input.expected_version + 1,
        active: input.selected,
    })
}
pub(super) fn list(db: &rusqlite::Connection, p: Uuid) -> Result<Results, Error> {
    context::project(db, p, false)?;
    let rows=db.prepare("SELECT candidate_id,source_version_id FROM relation_links WHERE project_id=? AND active=1 ORDER BY created_at,id LIMIT 100").map_err(failure)?.query_map([p.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    let mut items = Vec::new();
    for (id, origin) in rows {
        if let Some(item) = queries::item(db, p, uuid(id)?, Some(&origin))? {
            items.push(item)
        }
    }
    Ok(Results {
        total: items.len() as i64,
        items,
        offset: 0,
    })
}
