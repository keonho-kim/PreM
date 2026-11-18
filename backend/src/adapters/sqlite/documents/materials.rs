// Purpose: Own reusable-material indexing and version-bound resolution from canonical document data.
// Pattern: One transactional writer; reads join content blocks instead of copying their text.
// Usage: Extraction commits the index; Space and later generation resolve explicit material IDs.
// Related: results.rs, queries.rs, V1__baseline.sql, modules/documents/materials.rs.
use super::*;
use rusqlite::{OptionalExtension, params};
fn uuid(value: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}
fn safe_part(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() <= 500
        && !value.contains('\\')
        && !value.split('/').any(|s| s == ".." || s == ".")
        && !value.chars().any(char::is_control)
}
pub(super) fn index(
    db: &rusqlite::Transaction<'_>,
    extraction: Uuid,
    native: Option<NativePackage>,
) -> Result<(), Error> {
    if let Some(native) = native {
        if native.materials.len() > 10000
            || native.bundle.sha256.len() != 64
            || !native.bundle.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || native.bundle.size > 128 * 1024 * 1024
        {
            return Err(Error::Processing("invalid_materials"));
        }
        let registered: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM file_blobs WHERE sha256=? AND size_bytes=?)",
                params![native.bundle.sha256, native.bundle.size as i64],
                |r| r.get(0),
            )
            .map_err(failure)?;
        if !registered {
            return Err(Error::Storage);
        }
        db.execute(
            "INSERT INTO document_native_packages VALUES(?,?,1)",
            params![extraction.to_string(), native.bundle.sha256],
        )
        .map_err(failure)?;
        for (position, m) in native.materials.into_iter().enumerate() {
            if !["slide", "image", "diagram", "chart", "table"].contains(&m.kind.as_str())
                || m.key.is_empty()
                || m.key.len() > 100
                || m.title.len() > 800
                || !["item", "page", "none"].contains(&m.preview_scope.as_str())
                || !safe_part(&m.locator.slide_part, "ppt/slides/")
                || m.locator.shape_ids.len() > 1000
                || m.locator
                    .shape_ids
                    .iter()
                    .any(|s| s.is_empty() || s.len() > 20 || !s.bytes().all(|b| b.is_ascii_digit()))
                || m.locator
                    .image_part
                    .as_ref()
                    .is_some_and(|s| !safe_part(s, "ppt/media/"))
                || m.locator
                    .image_asset
                    .as_ref()
                    .is_some_and(|s| !safe_part(s, "images/"))
            {
                return Err(Error::Processing("invalid_materials"));
            }
            let page: String = db
                .query_row(
                    "SELECT id FROM document_pages WHERE extraction_id=? AND source_page=?",
                    params![extraction.to_string(), m.source_page],
                    |r| r.get(0),
                )
                .map_err(failure)?;
            db.execute(
                "INSERT INTO document_materials VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                params![
                    Uuid::new_v4().to_string(),
                    extraction.to_string(),
                    page,
                    m.key,
                    m.kind,
                    position as i64,
                    m.title,
                    Option::<String>::None,
                    serde_json::to_string(&m.locator).map_err(|_| Error::Storage)?,
                    m.preview,
                    m.preview_scope
                ],
            )
            .map_err(failure)?;
        }
    } else {
        let mut stmt=db.prepare("SELECT id,ordinal,label,preview_blob_sha256 FROM document_pages WHERE extraction_id=? AND preview_blob_sha256 IS NOT NULL ORDER BY ordinal").map_err(failure)?;
        let pages = stmt
            .query_map([extraction.to_string()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(failure)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(failure)?;
        for (page, ordinal, label, preview) in pages {
            db.execute(
                "INSERT INTO document_materials VALUES(?,?,?,?, 'page',?,?,NULL,NULL,?,'item')",
                params![
                    Uuid::new_v4().to_string(),
                    extraction.to_string(),
                    page,
                    format!("page:{ordinal}"),
                    0,
                    label,
                    preview
                ],
            )
            .map_err(failure)?;
        }
    }
    let native: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM document_native_packages WHERE extraction_id=?)",
            [extraction.to_string()],
            |r| r.get(0),
        )
        .map_err(failure)?;
    let blocks=db.prepare("SELECT b.id,b.page_id,b.position,b.kind,b.image_blob_sha256 FROM content_blocks b JOIN document_pages p ON p.id=b.page_id WHERE p.extraction_id=? AND (b.kind!='image' OR (?=0 AND b.image_blob_sha256 IS NOT NULL))").map_err(failure)?.query_map(params![extraction.to_string(),native],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?))).map_err(failure)?.collect::<Result<Vec<_>,_>>().map_err(failure)?;
    for (id, page, order, kind, preview) in blocks {
        let kind = match kind.as_str() {
            "image" => "image",
            "table" => "table",
            _ => "text",
        };
        db.execute(
            "INSERT INTO document_materials VALUES(?,?,?,?,?,?, '',?,NULL,?,?)",
            params![
                Uuid::new_v4().to_string(),
                extraction.to_string(),
                page,
                format!("block:{id}"),
                kind,
                10000 + order,
                id,
                preview,
                if preview.is_some() { "item" } else { "none" }
            ],
        )
        .map_err(failure)?;
    }
    Ok(())
}
const FROM: &str = "FROM document_materials m JOIN document_pages p ON p.id=m.page_id LEFT JOIN content_blocks b ON b.id=m.content_block_id WHERE m.extraction_id=?1";
const FILTER: &str = " AND (?2='' OR p.id=?2) AND (?3='all' OR (?3='slides' AND m.kind IN('slide','page')) OR (?3='visual' AND m.kind IN('image','diagram','chart')) OR (?3='text' AND m.kind IN('text','table'))) AND (?4='' OR instr(lower(m.title),lower(?4))>0 OR instr(lower(coalesce(b.text,'')),lower(?4))>0 OR (m.kind IN('slide','page','image','diagram','chart') AND EXISTS(SELECT 1 FROM content_blocks cb WHERE cb.page_id=p.id AND instr(lower(cb.text),lower(?4))>0)))";
const COLUMNS: &str = "m.id,m.page_id,p.label,p.source_page,m.kind,CASE WHEN m.title='' THEN substr(b.text,1,80) ELSE m.title END,b.text,m.content_block_id,m.preview_blob_sha256,m.preview_scope,m.native_locator_json";
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Material> {
    let locator: Option<String> = r.get(10)?;
    Ok(Material {
        id: uuid(r.get(0)?)?,
        page_id: uuid(r.get(1)?)?,
        page_label: r.get(2)?,
        source_page: r.get(3)?,
        kind: r.get(4)?,
        title: r.get(5)?,
        text: r.get(6)?,
        content_block_id: r.get::<_, Option<String>>(7)?.map(uuid).transpose()?,
        preview: r.get(8)?,
        preview_scope: r.get(9)?,
        native: locator
            .map(|s| serde_json::from_str(&s).map_err(|_| rusqlite::Error::InvalidQuery))
            .transpose()?,
    })
}
pub(super) fn catalog(
    db: &rusqlite::Connection,
    id: Uuid,
    page: Option<Uuid>,
    kind: String,
    q: String,
    offset: u32,
    selection: Option<Vec<Uuid>>,
) -> Result<MaterialCatalog, Error> {
    let job = queries::get(db, id)?;
    queries::visible(db, &job.kind, job.item_id)?;
    if job.kind != "references" {
        return Err(Error::NotFound);
    }
    let version: Option<i64> = db
        .query_row(
            "SELECT schema_version FROM document_extractions WHERE id=?",
            [job.extraction_id.map(|s| s.to_string())],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    let bundle: Option<String> = db
        .query_row(
            "SELECT bundle_blob_sha256 FROM document_native_packages WHERE extraction_id=?",
            [job.extraction_id.map(|s| s.to_string())],
            |r| r.get(0),
        )
        .optional()
        .map_err(failure)?;
    let parameters = params![
        job.extraction_id.map(|i| i.to_string()),
        page.map(|i| i.to_string()).unwrap_or_default(),
        kind,
        q
    ];
    let (total, items) = if let Some(ids) = selection {
        let mut items = Vec::new();
        for id in ids {
            let item = db
                .query_row(
                    &format!("SELECT {COLUMNS} {FROM} AND m.id=?2"),
                    params![job.extraction_id.map(|i| i.to_string()), id.to_string()],
                    row,
                )
                .optional()
                .map_err(failure)?
                .ok_or(Error::NotFound)?;
            items.push(item);
        }
        (items.len() as i64, items)
    } else {
        let total = db
            .query_row(
                &format!("SELECT count(*) {FROM}{FILTER}"),
                parameters,
                |r| r.get(0),
            )
            .map_err(failure)?;
        let sql = format!(
            "SELECT {COLUMNS} {FROM}{FILTER} ORDER BY p.ordinal,m.source_order,m.id LIMIT 50 OFFSET {offset}"
        );
        let items = db
            .prepare(&sql)
            .map_err(failure)?
            .query_map(parameters, row)
            .map_err(failure)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(failure)?;
        (total, items)
    };
    Ok(MaterialCatalog {
        schema_version: 1,
        reference_id: job.item_id,
        job_id: job.id,
        file_version: job.file_version,
        source_sha256: job.source_sha256,
        extraction_id: job.extraction_id,
        bundle,
        ready: version == Some(2),
        total,
        items,
    })
}
