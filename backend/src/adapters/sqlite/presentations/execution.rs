// Purpose: Bridge canonical PPT jobs to generic node persistence and durable rendered artifacts.
// Pattern: Short atomic transactions check the feature lease before every engine checkpoint.
// Usage: Presentation execution driver; no duplicate run-status owner is introduced.
// Related: sqlite/workflows.rs, modules/presentations/execution.rs, publish.rs.
use super::super::workflows as w;
use super::*;
use crate::workflows::{definitions::PRESENTATION, engine::Node};
fn error(e: w::Error) -> Error {
    match e {
        w::Error::Compatibility => Error::Processing("workflow_incompatible"),
        w::Error::Conflict => Error::Conflict,
        w::Error::Sql(e) => failure(e),
    }
}
pub(super) fn attach(db: &rusqlite::Connection, id: &str) -> Result<(), Error> {
    w::attach(db, id, PRESENTATION).map_err(error)?;
    db.execute(
        "INSERT INTO presentation_workflows VALUES(?,?)",
        params![id, id],
    )
    .map_err(failure)?;
    Ok(())
}
pub(super) fn begin(db: &mut rusqlite::Connection, r: Run, n: Node) -> Result<bool, Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    w::verify(&tx, &r.id.to_string(), PRESENTATION).map_err(error)?;
    let value = w::begin(
        &tx,
        &r.id.to_string(),
        n,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(value)
}
pub(super) fn finish(db: &mut rusqlite::Connection, r: Run, n: Node) -> Result<(), Error> {
    // publish checkpoints its final node atomically before releasing its job lease.
    if n.key == "publish" {
        let saved = queries::run(db, r.project_id, &r.id.to_string())?;
        if saved.status == "succeeded" {
            return Ok(());
        }
    }
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    w::finish(
        &tx,
        &r.id.to_string(),
        n.key,
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn publish(db: &rusqlite::Connection, r: &Run) -> Result<(), Error> {
    let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM workflow_nodes WHERE workflow_id=? AND node_key='publish' AND state='running')",[r.id.to_string()],|row|row.get(0)).map_err(failure)?;
    if exists {
        w::finish(
            db,
            &r.id.to_string(),
            "publish",
            r.lease.as_deref().ok_or(Error::Cancelled)?,
            now(),
        )
        .map_err(error)?;
    }
    Ok(())
}
pub(super) fn interrupt(db: &rusqlite::Connection, r: &Run, state: &str) -> Result<(), Error> {
    w::interrupt(db, &r.id.to_string(), r.lease.as_deref(), state, now()).map_err(error)
}
pub(super) fn store_render(
    db: &mut rusqlite::Connection,
    r: Run,
    output: Rendered,
) -> Result<(), Error> {
    let tx = db.transaction().map_err(failure)?;
    jobs::active(&tx, &r)?;
    let running:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM workflow_nodes WHERE workflow_id=? AND node_key='render' AND state='running' AND lease=?)",params![r.id.to_string(),r.lease],|r|r.get(0)).map_err(failure)?;
    if !running {
        return Err(Error::Cancelled);
    }
    if output.previews.len() != queries::slides(&tx, r.project_id, r.id)?.len() {
        return Err(Error::Storage);
    }
    plans::blob(
        &tx,
        &output.output,
        crate::modules::assets::Format::Pptx.mime(),
        "pptx",
    )?;
    tx.execute(
        "INSERT INTO workflow_artifacts VALUES(?,'render','output',0,?)",
        params![r.id.to_string(), output.output.sha256],
    )
    .map_err(failure)?;
    for (i, b) in output.previews.iter().enumerate() {
        plans::blob(&tx, b, "image/png", "png")?;
        tx.execute(
            "INSERT INTO workflow_artifacts VALUES(?,'render','preview',?,?)",
            params![r.id.to_string(), i as i64, b.sha256],
        )
        .map_err(failure)?;
    }
    // An approved proposal already passed these checks. Map its saved one-based positions
    // onto the newly committed slide versions without rendering or inferring again.
    tx.execute("INSERT INTO presentation_quality_checks(workflow_id,project_id,style_key,slide_version_id,position,passed,report_json,reused,cache_key) SELECT ?1,?2,q.style_key,x.slide_version_id,x.position,q.passed,q.report_json,1,q.cache_key FROM presentation_edits e JOIN presentation_quality_checks q ON q.workflow_id='edit:'||e.id JOIN presentation_run_slides x ON x.run_id=?1 AND x.position=q.position WHERE e.applied_run_id=?1 ON CONFLICT(workflow_id,slide_version_id) DO NOTHING",params![r.id.to_string(),r.project_id.to_string()]).map_err(failure)?;
    w::finish(
        &tx,
        &r.id.to_string(),
        "render",
        r.lease.as_deref().ok_or(Error::Cancelled)?,
        now(),
    )
    .map_err(error)?;
    tx.commit().map_err(failure)?;
    Ok(())
}
pub(super) fn rendered(db: &rusqlite::Connection, r: Run) -> Result<Option<Rendered>, Error> {
    jobs::active(db, &r)?;
    let rows=db.prepare("SELECT a.role,b.sha256,b.size_bytes FROM workflow_artifacts a JOIN file_blobs b ON b.sha256=a.blob_sha256 WHERE a.workflow_id=? AND a.node_key='render' ORDER BY a.role,a.position").map_err(failure)?.query_map([r.id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    if rows.is_empty() {
        return Ok(None);
    }
    let mut output = None;
    let mut previews = vec![];
    for (role, hash, size) in rows {
        let blob = DerivedBlob {
            sha256: hash,
            size: size.try_into().map_err(|_| Error::Storage)?,
            format: if role == "preview" {
                crate::modules::assets::DerivedFormat::Png
            } else {
                crate::modules::assets::DerivedFormat::Binary
            },
        };
        if role == "output" {
            output = Some(blob)
        } else {
            previews.push(blob)
        }
    }
    Ok(Some(Rendered {
        output: output.ok_or(Error::Storage)?,
        previews,
    }))
}
pub(super) fn stages(
    db: &rusqlite::Connection,
    id: &str,
) -> Result<Vec<crate::workflows::engine::Stage>, Error> {
    w::stages(db, id).map_err(error)
}
