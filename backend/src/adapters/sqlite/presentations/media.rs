// Purpose: Own immutable project image registrations and validated Blob references.
// Pattern: Content-based storage with idempotent registration IDs; no source-body duplication.
// Usage: Presentation media port; all project checks use the existing lifecycle owner.
// Related: modules/presentations/media.rs, V21 migration.
use super::*;
pub(super) fn list(db: &rusqlite::Connection, p: Uuid) -> Result<Vec<Media>, Error> {
    preparation::project(db, p, false)?;
    db.prepare("SELECT id,name,width,height,blob_sha256 FROM presentation_media WHERE project_id=? ORDER BY created_at,id").map_err(failure)?.query_map([p.to_string()],|r|Ok(Media{id:Uuid::parse_str(&r.get::<_,String>(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?,name:r.get(1)?,width:r.get(2)?,height:r.get(3)?,hash:r.get(4)?})).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)
}
pub(super) fn register(
    db: &mut rusqlite::Connection,
    p: Uuid,
    key: Uuid,
    name: String,
    original: DerivedBlob,
    image: NormalizedImage,
) -> Result<Media, Error> {
    let tx = db.transaction().map_err(failure)?;
    preparation::project(&tx, p, true)?;
    let old: Option<(String, String, String)> = tx
        .query_row(
            "SELECT project_id,name,original_sha256 FROM presentation_media WHERE id=?",
            [key.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some(old) = old {
        if old != (p.to_string(), name, original.sha256) {
            return Err(Error::Idempotency);
        }
        return list(&tx, p)?
            .into_iter()
            .find(|m| m.id == key)
            .ok_or(Error::NotFound);
    }
    if list(&tx, p)?.len() >= 100 {
        return Err(Error::Busy);
    }
    plans::blob(&tx, &original, &image.source_mime, "image")?;
    plans::blob(&tx, &image.blob, "image/png", "png")?;
    tx.execute(
        "INSERT INTO presentation_media VALUES(?,?,?,?,?,?,?,?)",
        params![
            key.to_string(),
            p.to_string(),
            name,
            original.sha256,
            image.blob.sha256,
            image.width,
            image.height,
            now()
        ],
    )
    .map_err(failure)?;
    tx.commit().map_err(failure)?;
    Ok(Media {
        id: key,
        name,
        width: image.width,
        height: image.height,
        hash: image.blob.sha256,
    })
}
