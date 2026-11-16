// Purpose: Commit version-checked library metadata, archive state and logical deletion.
// Pattern: One short immediate transaction; file versions and Blob bytes remain immutable.
// Usage: Invoked by the library store and upload version commit.
// Related: queries.rs, uploads.rs, modules/libraries/mod.rs.
use super::*;
use rusqlite::{TransactionBehavior, params};
pub(super) fn set_tags(db: &Connection, k: Kind, id: Uuid, tags: &[String]) -> Result<(), Error> {
    if k.project().is_some() {
        return if tags.is_empty() {
            Ok(())
        } else {
            Err(Error::Validation(
                "프로젝트 원본에는 태그를 지정하지 않습니다.",
            ))
        };
    }
    let p = k.prefix();
    db.execute(
        &format!("DELETE FROM {p}_tag_links WHERE item_id=?1"),
        [id.to_string()],
    )
    .map_err(storage)?;
    for tag in tags {
        db.execute(
            &format!("INSERT OR IGNORE INTO {p}_tags(id,name) VALUES (?1,?2)"),
            params![Uuid::new_v4().to_string(), tag],
        )
        .map_err(storage)?;
        db.execute(
            &format!(
                "INSERT INTO {p}_tag_links(item_id,tag_id) SELECT ?1,id FROM {p}_tags WHERE name=?2"
            ),
            params![id.to_string(), tag],
        )
        .map_err(storage)?;
    }
    Ok(())
}
pub(super) fn change(
    db: &mut Connection,
    k: Kind,
    id: Uuid,
    version: i64,
    change: Change,
    now: i64,
) -> Result<Item, Error> {
    queries::scope(db, k, true)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let p = k.prefix();
    let current = queries::get(&tx, k, id, true)?;
    let deleted: Option<i64> = tx
        .query_row(
            &format!("SELECT deleted_at FROM {p}_items WHERE id=?1"),
            [id.to_string()],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if deleted.is_some() {
        if matches!(change, Change::Delete) && current.version == version.saturating_add(1) {
            return Ok(current);
        }
        return Err(Error::NotFound);
    }
    if current.version != version {
        return Err(Error::Conflict);
    }
    let (title, tags, status, deleted) = match change {
        Change::Metadata { title, tags } => (title, tags, current.status.clone(), None),
        Change::Status(status) => (current.title.clone(), current.tags.clone(), status, None),
        Change::Delete => (
            current.title.clone(),
            current.tags.clone(),
            current.status.clone(),
            Some(now),
        ),
    };
    if deleted.is_none()
        && title == current.title
        && tags == current.tags
        && status == current.status
    {
        return Ok(current);
    }
    tx.execute(&format!("UPDATE {p}_items SET title=?1,status=?2,deleted_at=?3,version=version+1,updated_at=max(updated_at,?4) WHERE id=?5 AND version=?6"),params![title,status,deleted,now,id.to_string(),version]).map_err(storage)?;
    set_tags(&tx, k, id, &tags)?;
    let result = queries::get(&tx, k, id, true)?;
    tx.commit().map_err(storage)?;
    Ok(result)
}
