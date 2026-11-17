// Purpose: Expose published comparison lineage and explicit bounded undo commands.
// Pattern: Project-scoped read models and atomic immutable-revision restoration.
// Usage: Central canvas toolbar; no model invocation or regeneration for undo.
// Related: adapters/sqlite/presentations/history.rs, frontend/history-api.ts.
use super::*;
use serde::Serialize;
#[derive(Serialize)]
pub(crate) struct History {
    pub before_run_id: Option<Uuid>,
    pub slides: Vec<Comparison>,
    pub undo_remaining: usize,
}
#[derive(Serialize)]
pub(crate) struct Comparison {
    pub slide_id: Uuid,
    pub before_slide_id: Uuid,
}
impl Presentations {
    pub async fn history(
        &self,
        p: Uuid,
        run: Uuid,
        session: Option<Uuid>,
    ) -> Result<History, Error> {
        self.store.history(p, run, session).await
    }
    pub async fn undo(
        &self,
        p: Uuid,
        run: Uuid,
        key: Uuid,
        version: i64,
        session: Uuid,
    ) -> Result<Run, Error> {
        if version < 1 {
            return Err(Error::Invalid);
        }
        self.store.undo(p, run, key, version, session).await
    }
    pub async fn edit_preview(
        &self,
        p: Uuid,
        edit: Uuid,
        slide: Uuid,
    ) -> Result<(FileReader, File), Error> {
        let f = self.store.edit_preview(p, edit, slide).await?;
        let reader = self
            .assets
            .read(f.hash.clone())
            .await
            .map_err(|_| Error::Storage)?;
        Ok((reader, f))
    }
}

impl Presentations {
    pub async fn close_editors(&self) -> Result<(), Error> {
        self.store.expire_editors(true).await
    }
    pub async fn open_editor(&self, p: Uuid, run: Uuid, id: Uuid) -> Result<Uuid, Error> {
        self.store.open_editor(p, run, id).await
    }
    pub async fn touch_editor(&self, p: Uuid, id: Uuid) -> Result<(), Error> {
        self.store.touch_editor(p, id).await
    }
    pub async fn close_editor(&self, p: Uuid, id: Uuid) -> Result<(), Error> {
        self.store.close_editor(p, id).await
    }
}
