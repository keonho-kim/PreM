// Purpose: Read actual template layout geometry for manual entry and model authoring context.
// Pattern: Bounded local parser behind a narrow renderer port; source bytes stay immutable.
// Usage: Catalog requests and generation planning; no SQLite transaction spans this work.
// Related: presentation-canvas.py, modules/presentations/canvas.rs, presentation_inputs.rs.
use super::*;
use crate::modules::presentations::{CanvasLayout, Work};
impl Runtime {
    pub(super) fn canvas_layouts(&self, template: Option<String>) -> Work<Vec<CanvasLayout>> {
        let this = self.clone();
        Box::pin(async move {
            this.read_layouts(template).await.map_err(|e| match e {
                Error::Cancelled => crate::modules::presentations::Error::Cancelled,
                Error::Processing(c) => crate::modules::presentations::Error::Processing(c),
                _ => crate::modules::presentations::Error::Storage,
            })
        })
    }
    async fn read_layouts(&self, template: Option<String>) -> Result<Vec<CanvasLayout>, Error> {
        let _permit = self
            .media_gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Processing("runtime_busy"))?;
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("runtime_missing"))?;
        let installed = tokio::fs::read(self.root.join("presentation-canvas.py"))
            .await
            .map_err(|_| Error::Storage)?;
        if installed != include_bytes!("../../../tools/presentation-canvas.py") {
            return Err(Error::Processing("runtime_changed"));
        }
        let dir = tempfile::Builder::new()
            .prefix(".prem-process-")
            .tempdir_in(&self.work)
            .map_err(|_| Error::Storage)?;
        if let Some(hash) = template {
            let bytes = self
                .assets
                .bytes(hash, 50 * 1024 * 1024)
                .await
                .map_err(|_| Error::Storage)?;
            tokio::fs::write(dir.path().join("template.pptx"), bytes)
                .await
                .map_err(|_| Error::Storage)?;
        }
        let mut cmd = Command::new(&manifest.python);
        cmd.arg("-c").arg("import sys,runpy;sys.path.insert(0,sys.argv[1]);p=sys.argv.pop(1);script=sys.argv.pop(1);sys.argv[0]=script;runpy.run_path(script,run_name='__main__')")
            .arg(self.root.join("python-packages")).arg(self.root.join("presentation-canvas.py")).arg(&self.root).arg(dir.path())
            .current_dir(dir.path()).env("PYTHONDONTWRITEBYTECODE","1").env("TMPDIR",dir.path());
        self.run(cmd, CancellationToken::new()).await?;
        let layouts: Vec<CanvasLayout> = Self::json(&dir.path().join("layouts.json")).await?;
        if layouts.is_empty()
            || layouts.len() > 128
            || layouts
                .iter()
                .any(|l| l.key.len() > 80 || l.slots.len() > 32)
        {
            return Err(Error::Processing("layout_limit"));
        }
        Ok(layouts)
    }
}
