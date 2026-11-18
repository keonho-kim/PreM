// Purpose: Own persisted operational request capacity for each model connection.
// Pattern: Short CAS transactions, existing connection check and canonical default limits.
// Usage: SqliteRequests delegates capacity reads/writes here through its bounded writer.
// Related: modules/model_execution/capacity.rs, V1__baseline.sql.
use crate::modules::{
    model_execution::{Capacity, Error, Limits},
    model_registry,
};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"model request capacity storage failed");
    Error::Storage
}
pub(super) fn get(db: &Connection, id: Uuid) -> Result<Capacity, Error> {
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM llm_provider_connections WHERE id=?)",
            [id.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    if !exists {
        return Err(model_registry::Error::NotFound.into());
    }
    let saved = db.query_row("SELECT version,max_parallel,queue_capacity,queue_timeout_seconds FROM model_request_capacity WHERE connection_id=?", [id.to_string()], |r|Ok(Capacity {
        connection_id: id, version: r.get(0)?, limits: Limits { max_parallel: r.get(1)?, queue_capacity: r.get(2)?, queue_timeout_seconds: r.get(3)? },
    })).optional().map_err(failure)?;
    Ok(saved.unwrap_or(Capacity {
        connection_id: id,
        version: 0,
        limits: Limits::default(),
    }))
}
pub(super) fn save(
    db: &mut Connection,
    id: Uuid,
    expected: i64,
    limits: Limits,
) -> Result<Capacity, Error> {
    let limits = limits.validate()?;
    let tx = db.transaction().map_err(failure)?;
    let current = get(&tx, id)?;
    if expected != current.version {
        return Err(model_registry::Error::Conflict.into());
    }
    let version = expected.checked_add(1).ok_or(Error::Storage)?;
    tx.execute("INSERT INTO model_request_capacity(connection_id,version,max_parallel,queue_capacity,queue_timeout_seconds) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET version=excluded.version,max_parallel=excluded.max_parallel,queue_capacity=excluded.queue_capacity,queue_timeout_seconds=excluded.queue_timeout_seconds",params![id.to_string(),version,limits.max_parallel,limits.queue_capacity,limits.queue_timeout_seconds]).map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(Capacity {
        connection_id: id,
        version,
        limits,
    })
}
