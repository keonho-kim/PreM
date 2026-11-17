// Purpose: Persist generic definition identity, node checkpoints, artifact lineage and committed events.
// Pattern: Caller supplies a transaction and validated lease; no feature tables are written here.
// Usage: Presentation bridge fences canonical job ownership before invoking these operations.
// Related: workflows/engine/, V23 migration, presentations/execution.rs.
use crate::workflows::engine::Stage;
use crate::workflows::engine::{Definition, Node};
use rusqlite::{Connection, OptionalExtension, params};
#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("unsupported workflow definition")]
    Compatibility,
    #[error("workflow node is not ready")]
    Conflict,
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}
pub(super) fn attach(db: &Connection, id: &str, d: Definition) -> Result<(), Error> {
    db.execute(
        "INSERT INTO workflow_executions VALUES(?,?,?,?)",
        params![id, d.key, d.version, d.signature],
    )?;
    for (i, n) in d.nodes.iter().enumerate() {
        db.execute("INSERT INTO workflow_nodes(workflow_id,node_key,node_version,position,state) VALUES(?,?,?,?,'pending')",params![id,n.key,n.version,i as i64])?;
    }
    Ok(())
}
pub(super) fn verify(db: &Connection, id: &str, d: Definition) -> Result<(), Error> {
    let saved:Option<(String,i64,String)>=db.query_row("SELECT definition_key,definition_version,definition_signature FROM workflow_executions WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    if saved != Some((d.key.into(), d.version, d.signature.into())) {
        return Err(Error::Compatibility);
    }
    let nodes=db.prepare("SELECT node_key,node_version FROM workflow_nodes WHERE workflow_id=? ORDER BY position")?.query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
    if nodes
        != d.nodes
            .iter()
            .map(|n| (n.key.to_owned(), n.version))
            .collect::<Vec<_>>()
    {
        return Err(Error::Compatibility);
    }
    Ok(())
}
pub(super) fn event(
    db: &Connection,
    id: &str,
    node: &str,
    kind: &str,
    time: i64,
) -> Result<(), Error> {
    db.execute(
        "INSERT INTO workflow_events(workflow_id,node_key,event_type,created_at) VALUES(?,?,?,?)",
        params![id, node, kind, time],
    )?;
    Ok(())
}
pub(super) fn begin(
    db: &Connection,
    id: &str,
    n: Node,
    lease: &str,
    time: i64,
) -> Result<bool, Error> {
    let state: String = db.query_row(
        "SELECT state FROM workflow_nodes WHERE workflow_id=? AND node_key=?",
        params![id, n.key],
        |r| r.get(0),
    )?;
    if state == "succeeded" {
        return Ok(false);
    }
    for dep in n.dependencies {
        let ready: bool = db.query_row(
            "SELECT state='succeeded' FROM workflow_nodes WHERE workflow_id=? AND node_key=?",
            params![id, dep],
            |r| r.get(0),
        )?;
        if !ready {
            return Err(Error::Conflict);
        }
    }
    db.execute("UPDATE workflow_nodes SET state='running',attempt=attempt+1,lease=?,started_at=?,finished_at=NULL WHERE workflow_id=? AND node_key=?",params![lease,time,id,n.key])?;
    event(db, id, n.key, "started", time)?;
    Ok(true)
}
pub(super) fn finish(
    db: &Connection,
    id: &str,
    key: &str,
    lease: &str,
    time: i64,
) -> Result<(), Error> {
    let state: String = db.query_row(
        "SELECT state FROM workflow_nodes WHERE workflow_id=? AND node_key=?",
        params![id, key],
        |r| r.get(0),
    )?;
    if state == "succeeded" {
        return Ok(());
    }
    if db.execute("UPDATE workflow_nodes SET state='succeeded',lease=NULL,finished_at=? WHERE workflow_id=? AND node_key=? AND state='running' AND lease=?",params![time,id,key,lease])?!=1{return Err(Error::Conflict)}
    event(db, id, key, "succeeded", time)
}
pub(super) fn interrupt(
    db: &Connection,
    id: &str,
    lease: Option<&str>,
    state: &str,
    time: i64,
) -> Result<(), Error> {
    let keys=db.prepare("SELECT node_key FROM workflow_nodes WHERE workflow_id=? AND state='running' AND (? IS NULL OR lease=?)")?.query_map(params![id,lease,lease],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
    for key in keys {
        db.execute("UPDATE workflow_nodes SET state=?,lease=NULL,finished_at=? WHERE workflow_id=? AND node_key=?",params![state,time,id,key])?;
        event(db, id, &key, state, time)?;
    }
    Ok(())
}
pub(super) fn stages(db: &Connection, id: &str) -> Result<Vec<Stage>, Error> {
    Ok(db.prepare("SELECT node_key,state,attempt FROM workflow_nodes WHERE workflow_id=? ORDER BY position")?.query_map([id],|r|Ok(Stage{key:r.get(0)?,state:r.get(1)?,attempt:r.get(2)?}))?.collect::<Result<Vec<_>,_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflows::definitions::PRESENTATION;
    #[test]
    fn checkpoint_requires_current_node_lease_and_join_dependencies() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE workflow_executions(id TEXT PRIMARY KEY,definition_key TEXT,definition_version INTEGER,definition_signature TEXT);CREATE TABLE workflow_nodes(workflow_id TEXT,node_key TEXT,node_version INTEGER,position INTEGER,state TEXT,attempt INTEGER DEFAULT 0,lease TEXT,started_at INTEGER,finished_at INTEGER,PRIMARY KEY(workflow_id,node_key));CREATE TABLE workflow_events(id INTEGER PRIMARY KEY,workflow_id TEXT,node_key TEXT,event_type TEXT,created_at INTEGER);").unwrap();
        attach(&db, "run", PRESENTATION).unwrap();
        verify(&db, "run", PRESENTATION).unwrap();
        let write = PRESENTATION.nodes[0];
        let render = PRESENTATION.nodes[1];
        assert!(matches!(
            begin(&db, "run", render, "a", 1),
            Err(Error::Conflict)
        ));
        assert!(begin(&db, "run", write, "old", 1).unwrap());
        interrupt(&db, "run", Some("old"), "pending", 2).unwrap();
        assert!(begin(&db, "run", write, "new", 3).unwrap());
        assert!(finish(&db, "run", write.key, "old", 4).is_err());
        finish(&db, "run", write.key, "new", 5).unwrap();
        assert!(!begin(&db, "run", write, "third", 6).unwrap());
        assert!(begin(&db, "run", render, "third", 6).unwrap());
        db.execute(
            "UPDATE workflow_nodes SET node_version=2 WHERE node_key='write'",
            [],
        )
        .unwrap();
        assert!(matches!(
            verify(&db, "run", PRESENTATION),
            Err(Error::Compatibility)
        ));
    }
}
