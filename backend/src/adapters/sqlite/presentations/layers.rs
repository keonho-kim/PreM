// Purpose: Store and authorize passive canvas layers tied to exact validated slide cache entries.
// Pattern: Presentation quality is the write boundary; HTTP reads follow project/run/slide membership.
// Usage: Canvas backdrop/object PNG access, cache reuse and bounded eviction.
// Related: V31 migration, modules/presentations/layers.rs, quality.rs.
use super::*;
use crate::modules::assets::DerivedFormat;
impl LayerStore for SqlitePresentations {
    fn layers(&self, p: Uuid, run: Uuid, slide: Uuid) -> Work<Vec<LayerView>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                authorized(db, p, run, slide)?;
                Ok(read_for_slide(db, p, run, slide)?
                    .into_iter()
                    .map(|l| LayerView {
                        id: l.id,
                        frame: l.frame,
                    })
                    .collect())
            })
            .await
        })
    }
    fn layer_file(&self, p: Uuid, run: Uuid, slide: Uuid, id: String) -> Work<File> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| {
                authorized(db, p, run, slide)?;
                let layer = read_for_slide(db, p, run, slide)?
                    .into_iter()
                    .find(|l| l.id == id)
                    .ok_or(Error::NotFound)?;
                Ok(File {
                    hash: layer.blob.sha256,
                    size: layer.blob.size,
                    mime: "image/png",
                })
            })
            .await
        })
    }
}
fn authorized(db: &rusqlite::Connection, p: Uuid, run: Uuid, slide: Uuid) -> Result<(), Error> {
    let r = queries::run(db, p, &run.to_string())?;
    if r.status != "succeeded" {
        return Err(Error::NotReady);
    }
    let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM presentation_run_slides WHERE run_id=? AND slide_version_id=?)",params![run.to_string(),slide.to_string()],|r|r.get(0)).map_err(failure)?;
    if !valid {
        return Err(Error::NotFound);
    }
    Ok(())
}
fn read_for_slide(
    db: &rusqlite::Connection,
    p: Uuid,
    run: Uuid,
    slide: Uuid,
) -> Result<Vec<CanvasLayer>, Error> {
    let key:Option<String>=db.query_row("SELECT cache_key FROM presentation_quality_checks WHERE workflow_id=? AND slide_version_id=? AND project_id=? AND passed=1",params![run.to_string(),slide.to_string(),p.to_string()],|r|r.get(0)).optional().map_err(failure)?.flatten();
    key.map(|k| read(db, p, &k))
        .transpose()
        .map(Option::unwrap_or_default)
}
pub(super) fn read(
    db: &rusqlite::Connection,
    p: Uuid,
    key: &str,
) -> Result<Vec<CanvasLayer>, Error> {
    let rows=db.prepare("SELECT l.object_key,l.frame_json,b.sha256,b.size_bytes FROM presentation_render_layers l JOIN file_blobs b ON b.sha256=l.blob_sha256 WHERE l.project_id=? AND l.cache_key=? ORDER BY l.rowid").map_err(failure)?.query_map(params![p.to_string(),key],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    rows.into_iter()
        .map(|(id, frame, hash, size)| {
            Ok(CanvasLayer {
                id,
                frame: serde_json::from_str(&frame).map_err(|_| Error::Storage)?,
                blob: DerivedBlob {
                    sha256: hash,
                    size: size.try_into().map_err(|_| Error::Storage)?,
                    format: DerivedFormat::Png,
                },
            })
        })
        .collect()
}
pub(super) fn save(
    db: &rusqlite::Connection,
    p: Uuid,
    key: &str,
    rows: &[CanvasLayer],
) -> Result<(), Error> {
    if rows.len() > 21 {
        return Err(Error::Storage);
    }
    db.execute(
        "DELETE FROM presentation_render_layers WHERE project_id=? AND cache_key=?",
        params![p.to_string(), key],
    )
    .map_err(failure)?;
    for row in rows {
        row.frame.validate().map_err(|_| Error::Storage)?;
        plans::blob(db, &row.blob, "image/png", "png")?;
        db.execute(
            "INSERT INTO presentation_render_layers VALUES(?,?,?,?,?)",
            params![
                p.to_string(),
                key,
                row.id,
                row.blob.sha256,
                serde_json::to_string(&row.frame).map_err(|_| Error::Storage)?
            ],
        )
        .map_err(failure)?;
    }
    Ok(())
}
