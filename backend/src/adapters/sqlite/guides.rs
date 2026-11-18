// Purpose: Append guide revisions with optimistic concurrency and no workflow side effects.
// Pattern: One owner and short transaction; previous revisions stay immutable.
// Usage: The guide facade reads the latest revision or commits an explicit user edit.
// Related: modules/guides/, V1__baseline.sql.
use super::{Queue, Unavailable};
use crate::modules::guides::*;
use rusqlite::{OptionalExtension, params};
use std::sync::Arc;
use uuid::Uuid;
pub(super) struct SqliteGuides(pub Arc<Queue>);
impl From<Unavailable> for Error {
    fn from(_: Unavailable) -> Self {
        Self::Storage
    }
}
fn failure(e: rusqlite::Error) -> Error {
    tracing::error!(%e,"guide storage failed");
    Error::Storage
}
impl Store for SqliteGuides {
    fn guide(&self, id: Uuid, edit: Option<Edit>) -> Work {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move|db|{
 let tx=db.transaction().map_err(failure)?;
 let status:Option<String>=tx.query_row("SELECT status FROM projects WHERE id=? AND deleted_at IS NULL",[id.to_string()],|r|r.get(0)).optional().map_err(failure)?;
 let status=status.ok_or(Error::NotFound)?;
 let old:Option<(String,Guide)>=tx.query_row("SELECT id,version,do_text,dont_text FROM project_guide_revisions WHERE project_id=? ORDER BY version DESC LIMIT 1",[id.to_string()],|r|Ok((r.get(0)?,Guide{version:r.get(1)?,do_text:r.get(2)?,dont_text:r.get(3)?}))).optional().map_err(failure)?;
 let (parent,mut guide)=old.map(|(id,g)|(Some(id),g)).unwrap_or((None,Guide{version:0,do_text:String::new(),dont_text:String::new()}));
 if let Some(edit)=edit{
 if status!="active"||guide.version!=edit.expected_version{return Err(Error::Conflict)}
 guide=Guide{version:guide.version+1,do_text:edit.do_text.trim().into(),dont_text:edit.dont_text.trim().into()};
 tx.execute("INSERT INTO project_guide_revisions(id,project_id,parent_revision_id,version,do_text,dont_text,created_at) VALUES(?,?,?,?,?,?,?)",params![Uuid::new_v4().to_string(),id.to_string(),parent,guide.version,guide.do_text,guide.dont_text,crate::modules::libraries::now().map_err(|_|Error::Storage)?]).map_err(failure)?;
 }
 tx.commit().map_err(failure)?;Ok(guide)
 }).await
        })
    }
}
