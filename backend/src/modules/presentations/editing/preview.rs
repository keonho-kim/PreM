// Purpose: Render the full proposed deck for central before/after review without publishing it.
// Pattern: Existing renderer validates native PPTX; SQLite owns lease-fenced preview checkpoints.
// Usage: Edit worker after every targeted model checkpoint is complete.
// Related: editing/commands.rs, adapters/sqlite/presentations/edits/render.rs.
use super::*;
impl Presentations {
    pub(in crate::modules::presentations) async fn prepare_edit_preview(
        &self,
        e: &Edit,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let (slides, template_sha256) = self.store.edit_render_source(e.clone()).await?;
        let mut specs = vec![];
        for s in slides {
            specs.push((s.id, self.spec(s.spec.ok_or(Error::Storage)?).await?));
        }
        let output = self
            .render_checked(
                RenderScope {
                    project_id: e.project_id,
                    job_id: e.id,
                    lease: e.lease.clone().ok_or(Error::Cancelled)?,
                    editing: true,
                },
                RenderInput {
                    typography: None,
                    repair: false,
                    offset: 0,
                    specs,
                    template_sha256,
                    references: self.store.imports(e.project_id).await?,
                    media: self.store.media(e.project_id).await?,
                },
                cancel.clone(),
            )
            .await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store.edit_render_ready(e.clone(), output).await
    }
}
