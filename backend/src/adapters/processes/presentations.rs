// Purpose: Render and verify editable decks with bundled PPT Master, python-pptx and Kordoc.
// Pattern: Owned temporary directory, bounded subprocesses and passive PNG outputs.
// Usage: Presentation worker supplies validated specs and an optional immutable template Blob.
// Related: backend/tools/presentation-render.py, presentation-validate.mjs.
use super::*;
use crate::modules::{
    assets::{DerivedBlob, DerivedFormat},
    presentations::{self, QualityReport, RenderInput, Rendered, SlideOutput, Work},
};
impl presentations::Renderer for Runtime {
    fn layouts(&self, template: Option<String>) -> Work<Vec<presentations::CanvasLayout>> {
        self.canvas_layouts(template)
    }
    fn assemble(&self, parts: Vec<DerivedBlob>, cancel: CancellationToken) -> Work<DerivedBlob> {
        let this = self.clone();
        Box::pin(async move {
            this.assemble_presentation(parts, cancel)
                .await
                .map_err(|e| match e {
                    Error::Cancelled => presentations::Error::Cancelled,
                    Error::Processing(c) => presentations::Error::Processing(c),
                    _ => presentations::Error::Storage,
                })
        })
    }
    fn image(&self, bytes: Vec<u8>) -> Work<presentations::NormalizedImage> {
        let this = self.clone();
        Box::pin(async move { this.normalize_image(bytes).await })
    }
    fn profile(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.profile.as_bytes());
        h.update(include_bytes!("../../../tools/presentation-render.py"));
        h.update(include_bytes!("../../../tools/presentation-canvas.py"));
        h.update(include_bytes!("../../../tools/presentation-layers.py"));
        h.update(include_bytes!("../../../tools/presentation-previews.mjs"));
        h.update(include_bytes!("../../../tools/presentation-objects.py"));
        h.update(include_bytes!("../../../tools/presentation-quality.py"));
        h.update(include_bytes!("../../../tools/presentation-assemble.py"));
        h.update(include_bytes!("../../../tools/presentation-references.py"));
        h.update(include_bytes!("../../../tools/presentation-validate.mjs"));
        h.update(include_bytes!(
            "../../../../scripts/runtime/requirements.lock"
        ));
        hex::encode(h.finalize())
    }
    fn render(&self, input: RenderInput, cancel: CancellationToken) -> Work<SlideOutput> {
        let this = self.clone();
        Box::pin(async move {
            match this.render_presentation(input, cancel).await {
                Ok((Some(rendered), report, layers)) => Ok(SlideOutput {
                    rendered,
                    report,
                    layers,
                }),
                Ok((None, report, _)) => Err(presentations::Error::Quality(report)),
                Err(Error::Cancelled) => Err(presentations::Error::Cancelled),
                Err(Error::Processing(c)) => Err(presentations::Error::Processing(c)),
                Err(_) => Err(presentations::Error::Storage),
            }
        })
    }
}
impl Runtime {
    async fn render_presentation(
        &self,
        input: RenderInput,
        cancel: CancellationToken,
    ) -> Result<
        (
            Option<Rendered>,
            QualityReport,
            Vec<presentations::CanvasLayer>,
        ),
        Error,
    > {
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(Error::Processing("runtime_missing"))?;
        for (name, expected) in [
            (
                "presentation-layers.py",
                include_bytes!("../../../tools/presentation-layers.py").as_slice(),
            ),
            (
                "presentation-previews.mjs",
                include_bytes!("../../../tools/presentation-previews.mjs").as_slice(),
            ),
            (
                "presentation-canvas.py",
                include_bytes!("../../../tools/presentation-canvas.py").as_slice(),
            ),
            (
                "presentation-quality.py",
                include_bytes!("../../../tools/presentation-quality.py").as_slice(),
            ),
            (
                "presentation-assemble.py",
                include_bytes!("../../../tools/presentation-assemble.py").as_slice(),
            ),
            (
                "presentation-references.py",
                include_bytes!("../../../tools/presentation-references.py").as_slice(),
            ),
            (
                "presentation-render.py",
                include_bytes!("../../../tools/presentation-render.py").as_slice(),
            ),
            (
                "presentation-objects.py",
                include_bytes!("../../../tools/presentation-objects.py").as_slice(),
            ),
            (
                "presentation-validate.mjs",
                include_bytes!("../../../tools/presentation-validate.mjs").as_slice(),
            ),
        ] {
            let installed = tokio::fs::read(self.root.join(name))
                .await
                .map_err(|_| Error::Processing("runtime_missing"))?;
            if installed != expected {
                return Err(Error::Processing("runtime_changed"));
            }
        }
        let dir = tempfile::Builder::new()
            .prefix(".prem-process-")
            .tempdir_in(&self.work)
            .map_err(|_| Error::Storage)?;
        self.presentation_inputs(dir.path(), &input).await?;
        let mut cmd = Command::new(&manifest.python);
        cmd.arg(self.root.join("presentation-render.py"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir.path());
        let result = self.run(cmd, cancel.clone()).await;
        if matches!(result, Err(Error::Cancelled)) {
            return Err(Error::Cancelled);
        }
        let report: QualityReport = Self::json(&dir.path().join("quality.json")).await?;
        if !report.passed {
            return Ok((None, report, vec![]));
        }
        result.map_err(|_| Error::Processing("presentation_render_failed"))?;
        let mut verify = Command::new(&manifest.node);
        verify
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.path().display()))
            .arg(format!("--allow-fs-write={}", dir.path().display()))
            .arg(self.root.join("presentation-validate.mjs"))
            .arg(dir.path())
            .current_dir(dir.path())
            .env("KORDOC_OFFLINE", "1");
        if let Err(e) = self.run(verify, cancel.clone()).await {
            if matches!(e, Error::Cancelled) {
                return Err(e);
            }
            let mut report = report;
            report.passed = false;
            report.issues.push(presentations::QualityIssue {
                code: "output_text_missing".into(),
                severity: "error".into(),
            });
            return Ok((None, report, vec![]));
        }
        let mut preview = Command::new(&manifest.python);
        preview
            .arg(self.root.join("template-extract.py"))
            .arg(&self.root)
            .arg(dir.path().join("output.pptx"))
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("TMPDIR", dir.path());
        self.run(preview, cancel.clone()).await?;
        let mut layers = Command::new(&manifest.python);
        layers
            .arg(self.root.join("presentation-layers.py"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path())
            .env("PYTHONDONTWRITEBYTECODE", "1");
        self.run(layers, cancel.clone()).await?;
        let mut raster = Command::new(&manifest.node);
        raster
            .arg("--max-old-space-size=512")
            .arg("--permission")
            .arg("--allow-addons")
            .arg("--allow-worker")
            .arg(format!("--allow-fs-read={}", self.root.display()))
            .arg(format!("--allow-fs-read={}", dir.path().display()))
            .arg(format!("--allow-fs-write={}", dir.path().display()))
            .arg(self.root.join("presentation-previews.mjs"))
            .arg(&self.root)
            .arg(dir.path())
            .current_dir(dir.path());
        self.run(raster, cancel.clone()).await?;
        let mut previews = vec![];
        for n in 1..=input.specs.len() {
            previews.push(
                self.presentation_blob(
                    &dir.path().join(format!("preview-{n}.png")),
                    4 * 1024 * 1024,
                    DerivedFormat::Png,
                )
                .await?,
            );
        }
        let output = self
            .presentation_blob(
                &dir.path().join("output.pptx"),
                50 * 1024 * 1024,
                DerivedFormat::Binary,
            )
            .await?;
        let layer_data: Vec<super::presentation_layers::LayerFile> =
            Self::json(&dir.path().join("layers.json")).await?;
        let mut layers = vec![];
        for (n, row) in layer_data.into_iter().enumerate() {
            if row.file != format!("layer-{n}.png") {
                return Err(Error::Processing("invalid_layer"));
            }
            layers.push(presentations::CanvasLayer {
                id: row.id,
                frame: row.frame,
                blob: self
                    .presentation_blob(
                        &dir.path().join(row.file),
                        4 * 1024 * 1024,
                        DerivedFormat::Png,
                    )
                    .await?,
            });
        }
        Ok((Some(Rendered { output, previews }), report, layers))
    }
    pub(super) async fn presentation_blob(
        &self,
        path: &Path,
        limit: u64,
        format: DerivedFormat,
    ) -> Result<DerivedBlob, Error> {
        let meta = tokio::fs::symlink_metadata(path)
            .await
            .map_err(|_| Error::Storage)?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
            return Err(Error::Processing("output_limit"));
        }
        self.assets
            .publish(
                tokio::fs::read(path).await.map_err(|_| Error::Storage)?,
                format,
            )
            .await
            .map_err(|_| Error::Storage)
    }
}
