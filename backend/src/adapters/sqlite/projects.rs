// Purpose: Persist shared project queries, request receipts and conditional lifecycle changes.
// Pattern: Parameterized SQL on the owned writer; one transaction per command.
// Usage: Implements the project feature's persistence port.
// Related: modules/projects/ports.rs, migrations/V2__project_home.sql.
use super::Queue;
use crate::modules::projects::{
    Change, CreateResult, Error, ListQuery, Project, ProjectList, ProjectStore, StoreFuture,
};
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteProjects(pub Arc<Queue>);
const COLUMNS: &str = "id, name, version, created_at, updated_at, due_date, status, deleted_at";
const FILTER: &str = "deleted_at IS NULL AND instr(lower(name),lower(?1))>0 AND (?2='all' OR status=?2) AND (?3 IS NULL OR due_date>=?3) AND (?4 IS NULL OR due_date<=?4) AND (?5 IS NULL OR due_date=?5)";
fn storage(error: rusqlite::Error) -> Error {
    tracing::error!(%error, "project database operation failed");
    Error::Storage
}
fn row(row: &Row<'_>) -> rusqlite::Result<Project> {
    let id: String = row.get(0)?;
    let id = Uuid::parse_str(&id).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(Project {
        id,
        name: row.get(1)?,
        version: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        due_date: row.get(5)?,
        status: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}
fn get(db: &Connection, id: Uuid, include_deleted: bool) -> Result<Project, Error> {
    let project = db
        .query_row(
            &format!("SELECT {COLUMNS} FROM projects WHERE id=?1"),
            [id.to_string()],
            row,
        )
        .optional()
        .map_err(storage)?
        .ok_or(Error::NotFound)?;
    if project.deleted_at.is_some() && !include_deleted {
        return Err(Error::NotFound);
    }
    Ok(project)
}
fn list(db: &mut Connection, query: ListQuery) -> Result<ProjectList, Error> {
    // Count and page observe one consistent snapshot.
    let tx = db.transaction().map_err(storage)?;
    let total: i64 = tx
        .query_row(
            &format!("SELECT count(*) FROM projects WHERE {FILTER}"),
            params![
                query.query,
                query.status,
                query.due_from,
                query.due_to,
                query.due_date
            ],
            |r| r.get(0),
        )
        .map_err(storage)?;
    let order = match query.sort.as_str() {
        "name" => "name COLLATE NOCASE, id",
        "deadline" => "due_date IS NULL, due_date, id",
        _ => "updated_at DESC, id",
    };
    let sql = format!(
        "SELECT {COLUMNS} FROM projects WHERE {FILTER} ORDER BY {order} LIMIT ?6 OFFSET ?7"
    );
    let mut statement = tx.prepare(&sql).map_err(storage)?;
    let items = statement
        .query_map(
            params![
                query.query,
                query.status,
                query.due_from,
                query.due_to,
                query.due_date,
                query.limit,
                query.offset
            ],
            row,
        )
        .map_err(storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage)?;
    Ok(ProjectList {
        items,
        total: u64::try_from(total).map_err(|_| Error::Storage)?,
        limit: query.limit,
        offset: query.offset,
    })
}
fn create(db: &mut Connection, project: Project, key: Uuid) -> Result<CreateResult, Error> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let receipt: Option<(String, Option<String>, String)> = tx.query_row(
        "SELECT original_name,original_due_date,project_id FROM project_creation_requests WHERE request_key=?1",
        [key.to_string()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).optional().map_err(storage)?;
    if let Some((name, date, id)) = receipt {
        if name != project.name || date != project.due_date {
            return Err(Error::IdempotencyConflict);
        }
        let id = Uuid::parse_str(&id).map_err(|_| Error::Storage)?;
        return Ok(CreateResult {
            project: get(&tx, id, false)?,
            replayed: true,
        });
    }
    tx.execute(
        "INSERT INTO projects(id,name,version,created_at,updated_at,due_date) VALUES(?1,?2,1,?3,?3,?4)",
        params![project.id.to_string(),project.name,project.created_at,project.due_date],
    ).map_err(storage)?;
    tx.execute(
        "INSERT INTO project_creation_requests(request_key,original_name,original_due_date,project_id) VALUES(?1,?2,?3,?4)",
        params![key.to_string(),project.name,project.due_date,project.id.to_string()],
    ).map_err(storage)?;
    tx.commit().map_err(storage)?;
    Ok(CreateResult {
        project,
        replayed: false,
    })
}
fn update(
    db: &mut Connection,
    id: Uuid,
    change: Change,
    version: i64,
    now: i64,
) -> Result<Project, Error> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let current = get(&tx, id, true)?;
    // An uncertain DELETE can be retried without resurrecting its tombstone.
    if current.deleted_at.is_some() {
        if matches!(change, Change::Delete) && current.version == version.saturating_add(1) {
            return Ok(current);
        }
        return Err(Error::NotFound);
    }
    if current.version != version {
        return Err(Error::Conflict);
    }
    if matches!(&change, Change::Name(name) if name == &current.name)
        || matches!(&change, Change::Status(status) if status == &current.status)
    {
        return Ok(current);
    }
    let (name, status, deleted) = match change {
        Change::Name(name) => (name, current.status, None),
        Change::Status(status) => (current.name, status, None),
        Change::Delete => (current.name, current.status, Some(now)),
    };
    tx.execute(
        "UPDATE projects SET name=?1,status=?2,deleted_at=?3,version=version+1,updated_at=max(updated_at,?4) WHERE id=?5 AND version=?6",
        params![name,status,deleted,now,id.to_string(),version],
    ).map_err(storage)?;
    let result = get(&tx, id, true)?;
    tx.commit().map_err(storage)?;
    Ok(result)
}
impl ProjectStore for SqliteProjects {
    fn list(&self, query: ListQuery) -> StoreFuture<ProjectList> {
        let queue = self.0.clone();
        Box::pin(async move { queue.call(move |db| list(db, query)).await })
    }
    fn get(&self, id: Uuid) -> StoreFuture<Project> {
        let queue = self.0.clone();
        Box::pin(async move { queue.call(move |db| get(db, id, false)).await })
    }
    fn create(&self, project: Project, key: Uuid) -> StoreFuture<CreateResult> {
        let queue = self.0.clone();
        Box::pin(async move { queue.call(move |db| create(db, project, key)).await })
    }
    fn update(&self, id: Uuid, change: Change, version: i64, now: i64) -> StoreFuture<Project> {
        let queue = self.0.clone();
        Box::pin(async move {
            queue
                .call(move |db| update(db, id, change, version, now))
                .await
        })
    }
}
