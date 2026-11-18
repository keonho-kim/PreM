// Purpose: Read canonical library items and immutable file-version metadata.
// Pattern: Parameterized queries with trusted table prefixes and one snapshot per list.
// Usage: The library adapter uses these queries within its atomic write transactions too.
// Related: mod.rs, uploads.rs, migrations/V1__baseline.sql.
use super::*;
use rusqlite::{OptionalExtension, Row, params};
const FIELDS: &str = "i.id,i.title,i.status,i.version,v.number,f.original_filename,b.sha256,b.size_bytes,b.detected_mime,b.format,i.created_at,i.updated_at,coalesce((SELECT j.status FROM document_jobs j WHERE j.reference_version_id=v.id OR j.template_version_id=v.id OR j.source_version_id=v.id ORDER BY j.generation DESC LIMIT 1),'not_started')";
fn row(r: &Row<'_>, kind: Kind) -> rusqlite::Result<Item> {
    Ok(Item {
        kind,
        id: uuid(r.get(0)?)?,
        title: r.get(1)?,
        tags: vec![],
        status: r.get(2)?,
        version: r.get(3)?,
        file_version: r.get(4)?,
        filename: r.get(5)?,
        blob_sha256: r.get(6)?,
        size: u64::from(r.get::<_, u32>(7)?),
        mime: r.get(8)?,
        format: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        processing: r.get(12)?,
    })
}
fn join(k: Kind) -> String {
    let p = k.prefix();
    format!(
        "{p}_items i JOIN {p}_versions v ON v.id=i.current_version_id JOIN file_registrations f ON f.id=v.file_registration_id JOIN registered_file_facts b ON b.registration_id=f.id"
    )
}
pub(super) fn get(db: &Connection, k: Kind, id: Uuid, deleted: bool) -> Result<Item, Error> {
    scope(db, k, false)?;
    let scope = if k.project().is_some() {
        "i.project_id=?3"
    } else {
        "?3 IS NULL"
    };
    let sql = format!(
        "SELECT {FIELDS} FROM {} WHERE i.id=?1 AND (?2 OR i.deleted_at IS NULL) AND {scope}",
        join(k)
    );
    let mut item = db
        .query_row(
            &sql,
            params![id.to_string(), deleted, k.project().map(|p| p.to_string())],
            |r| row(r, k),
        )
        .optional()
        .map_err(storage)?
        .ok_or(Error::NotFound)?;
    item.tags = tags(db, k, id)?;
    Ok(item)
}
fn selection(kind: Kind) -> String {
    let scope = if kind.project().is_some() {
        "i.project_id=?5"
    } else {
        "?5 IS NULL"
    };
    let tags = if kind.project().is_some() {
        "0".to_owned()
    } else {
        let p = kind.prefix();
        format!(
            "EXISTS(SELECT 1 FROM {p}_tags t JOIN {p}_tag_links l ON l.tag_id=t.id WHERE l.item_id=i.id AND instr(lower(t.name),lower(?1))>0)"
        )
    };
    let p = kind.prefix();
    format!(
        "SELECT {FIELDS},'{p}' AS kind FROM {} WHERE i.deleted_at IS NULL AND {scope} AND (?2='all' OR i.status=?2) AND (instr(lower(i.title),lower(?1))>0 OR instr(lower(f.original_filename),lower(?1))>0 OR {tags} OR EXISTS(SELECT 1 FROM document_jobs j JOIN document_pages dp ON dp.extraction_id=j.extraction_id JOIN content_blocks cb ON cb.page_id=dp.id WHERE j.{p}_version_id=v.id AND instr(lower(cb.text),lower(?1))>0))",
        join(kind)
    )
}
pub(super) fn list(db: &mut Connection, q: ListQuery) -> Result<ItemList, Error> {
    if let Some(k) = q.kind {
        scope(db, k, false)?;
    }
    let project = q.kind.and_then(|k| k.project()).map(|p| p.to_string());
    let tx = db.transaction().map_err(storage)?;
    let source = match q.kind {
        Some(kind) => selection(kind),
        None => format!(
            "{} UNION ALL {}",
            selection(Kind::Reference),
            selection(Kind::Template)
        ),
    };
    let total: i64 = tx
        .query_row(
            &format!("SELECT count(*) FROM ({source})"),
            params![q.q, q.status, q.limit, q.offset, project],
            |r| r.get(0),
        )
        .map_err(storage)?;
    let sql =
        format!("SELECT * FROM ({source}) ORDER BY updated_at DESC,id,kind LIMIT ?3 OFFSET ?4");
    let mut statement = tx.prepare(&sql).map_err(storage)?;
    let mut items = statement
        .query_map(params![q.q, q.status, q.limit, q.offset, project], |r| {
            let kind = if let Some(id) = q.kind.and_then(|k| k.project()) {
                Kind::Source(id)
            } else if r.get::<_, String>(13)? == "reference" {
                Kind::Reference
            } else {
                Kind::Template
            };
            row(r, kind)
        })
        .map_err(storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage)?;
    for item in &mut items {
        item.tags = tags(&tx, item.kind, item.id)?;
    }
    Ok(ItemList {
        items,
        total: u64::try_from(total).map_err(|_| Error::Storage)?,
        limit: q.limit,
        offset: q.offset,
    })
}
pub(super) fn versions(db: &Connection, k: Kind, id: Uuid) -> Result<Vec<FileVersion>, Error> {
    get(db, k, id, false)?;
    let p = k.prefix();
    let mut statement=db.prepare(&format!("SELECT v.number,f.original_filename,b.sha256,b.size_bytes,b.detected_mime,v.created_at FROM {p}_versions v JOIN file_registrations f ON f.id=v.file_registration_id JOIN registered_file_facts b ON b.registration_id=f.id WHERE v.item_id=?1 ORDER BY v.number DESC")).map_err(storage)?;
    statement
        .query_map([id.to_string()], |r| {
            Ok(FileVersion {
                number: r.get(0)?,
                filename: r.get(1)?,
                blob_sha256: r.get(2)?,
                size: u64::from(r.get::<_, u32>(3)?),
                mime: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(storage)?
        .collect::<rusqlite::Result<_>>()
        .map_err(storage)
}

pub(super) fn scope(db: &Connection, kind: Kind, write: bool) -> Result<(), Error> {
    if let Some(id) = kind.project() {
        let status: Option<String> = db
            .query_row(
                "SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()
            .map_err(storage)?;
        let status = status.ok_or(Error::NotFound)?;
        if write && status != "active" {
            return Err(Error::Validation("보관된 프로젝트는 복원한 뒤 수정하세요."));
        }
    }
    Ok(())
}
