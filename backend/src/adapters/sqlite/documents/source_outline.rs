// Purpose: Publish and project exact source outline rows alongside their page assignments.
// Pattern: Ordered parent-child rows are scoped to a single job and immutable extraction.
// Usage: Called inside the alignment commit transaction and document detail query.
// Related: V1__baseline.sql, alignment.rs.
use super::*;
use rusqlite::Connection;
pub(super) fn save(db: &Connection, job: &Job, roots: &[SourceEntry]) -> Result<(), Error> {
    let mut pos = 0;
    let mut insert = |e: &SourceEntry, parent: Option<i64>| -> Result<i64, Error> {
        let count=db.execute("INSERT INTO document_source_entries SELECT j.id,?2,?3,?4,?5,b.id,?7 FROM document_jobs j JOIN document_pages p ON p.extraction_id=j.extraction_id JOIN content_blocks b ON b.page_id=p.id WHERE j.id=?1 AND b.id=?6",params![job.id.to_string(),pos,parent,e.title,e.printed,e.block.to_string(),e.line]).map_err(failure)?;
        if count != 1 {
            return Err(Error::Conflict);
        }
        pos += 1;
        Ok(pos - 1)
    };
    for e in roots {
        let parent = insert(e, None)?;
        for child in &e.children {
            insert(child, Some(parent))?;
        }
    }
    Ok(())
}
pub(super) fn load(db: &Connection, job: Uuid) -> Result<Vec<SourceEntry>, Error> {
    let mut q=db.prepare("SELECT position,parent,title,printed,block_id,line FROM document_source_entries WHERE job_id=? ORDER BY position").map_err(failure)?;
    let rows = q
        .query_map([job.to_string()], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                SourceEntry {
                    title: r.get(2)?,
                    printed: r.get(3)?,
                    block: Uuid::parse_str(&r.get::<_, String>(4)?)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                    line: r.get(5)?,
                    children: vec![],
                },
            ))
        })
        .map_err(failure)?;
    let mut roots: Vec<SourceEntry> = vec![];
    let mut parent_pos = None;
    for row in rows {
        let (pos, parent, e) = row.map_err(failure)?;
        if parent.is_none() {
            parent_pos = Some(pos);
            roots.push(e);
        } else if parent_pos == parent {
            roots.last_mut().ok_or(Error::Storage)?.children.push(e);
        } else {
            return Err(Error::Storage);
        }
    }
    Ok(roots)
}
