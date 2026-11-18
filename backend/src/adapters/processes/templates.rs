// Purpose: Adapt PPT Master to template-only extraction with separate persistence ownership.
// Pattern: Shared process mechanics; template results never create reference content blocks.
// Usage: Template uploads only; references call the process importer through their own adapter.
// Related: pptx.rs, modules/templates/, adapters/sqlite/templates.rs.
use super::*;
use crate::modules::{
    assets::DerivedBlob,
    templates::{self, Analysis, Input, Work},
};
impl templates::Extractor for Runtime {
    fn extract(&self, input: Input, cancel: CancellationToken) -> Work<(Analysis, DerivedBlob)> {
        let this = self.clone();
        Box::pin(async move {
            if input.profile != this.profile {
                return Err(templates::Error::MissingRuntime);
            }
            let (dir, source) = this
                .workspace(input.source_sha256, "pptx")
                .await
                .map_err(|_| templates::Error::Failed)?;
            this.import_pptx(&source, dir.path(), cancel, false)
                .await
                .map_err(|e| match e {
                    Error::Cancelled => templates::Error::Cancelled,
                    Error::Processing("template_runtime_missing") => {
                        templates::Error::MissingRuntime
                    }
                    Error::Processing("document_step_timeout") => templates::Error::TimedOut,
                    Error::Storage => templates::Error::Storage,
                    _ => templates::Error::Failed,
                })
        })
    }
}
