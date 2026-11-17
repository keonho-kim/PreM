// Purpose: Checkpoint individual validated slide renders and assemble only after every slide passes.
// Pattern: Content-addressed reuse, bounded typography repair and lease-fenced feature persistence.
// Usage: Generation and reviewed edit previews; source content is never rewritten to fit a slide.
// Related: sqlite/presentations/quality.rs, processes/presentation_assembly.rs, V29 migration.
use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QualityIssue {
    pub code: String,
    pub severity: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QualityReport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<Typography>,
    pub schema_version: u8,
    pub passed: bool,
    pub repair_attempts: u8,
    pub issues: Vec<QualityIssue>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Typography {
    pub title: f64,
    pub body: f64,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct SlideQuality {
    pub position: i64,
    pub report: QualityReport,
    pub reused: bool,
}
#[derive(Clone)]
pub(crate) struct RenderScope {
    pub project_id: Uuid,
    pub job_id: Uuid,
    pub lease: String,
    pub editing: bool,
}
impl RenderScope {
    pub fn workflow(&self) -> String {
        if self.editing {
            format!("edit:{}", self.job_id)
        } else {
            self.job_id.to_string()
        }
    }
}
#[derive(Clone)]
pub(crate) struct CachedSlide {
    pub output: DerivedBlob,
    pub preview: DerivedBlob,
    pub report: QualityReport,
    pub layers: Vec<super::CanvasLayer>,
}
pub(crate) struct SlideCheck {
    pub scope: RenderScope,
    pub slide_id: Uuid,
    pub position: i64,
    pub key: String,
    pub style_key: String,
    pub report: QualityReport,
    pub rendered: Option<CachedSlide>,
    pub reused: bool,
}
pub(crate) trait QualityStore: Send + Sync {
    fn render_policy(&self, r: Run) -> Work<bool>;
    fn render_style(&self, project: Uuid, key: String) -> Work<Option<Typography>>;
    fn cached_slide(&self, project: Uuid, key: String) -> Work<Option<CachedSlide>>;
    fn check_slide(&self, check: SlideCheck) -> Work<()>;
}
pub(crate) struct SlideOutput {
    pub rendered: Rendered,
    pub report: QualityReport,
    pub layers: Vec<super::CanvasLayer>,
}
impl Presentations {
    async fn cached_intact(&self, item: &CachedSlide) -> bool {
        for (blob, limit) in [
            (&item.output, 50 * 1024 * 1024),
            (&item.preview, 4 * 1024 * 1024),
        ] {
            let Ok(bytes) = self.assets.bytes(blob.sha256.clone(), limit).await else {
                return false;
            };
            if bytes.len() as u64 != blob.size || hex::encode(Sha256::digest(&bytes)) != blob.sha256
            {
                return false;
            }
        }
        item.report.passed
    }
    pub(super) async fn render_checked(
        &self,
        scope: RenderScope,
        input: RenderInput,
        cancel: CancellationToken,
    ) -> Result<Rendered, Error> {
        let mut parts = vec![];
        let mut previews = vec![];
        for (position, (id, spec)) in input.specs.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            authoring::validate_spec(spec)?;
            let media: Vec<_> = input.media.iter().filter(|m|spec.objects.iter().any(|o| matches!(&o.content, ObjectContent::Image {media_id} if *media_id==m.id))).map(|m| (m.id, &m.hash)).collect();
            let references: Vec<_> = input.references.iter().filter(|m|spec.objects.iter().any(|o| matches!(&o.content, ObjectContent::Reference {reference_id} if *reference_id==m.id))).collect();
            let bytes = serde_json::to_vec(&(
                self.renderer.profile(),
                spec,
                position,
                &input.template_sha256,
                media,
                references,
            ))
            .map_err(|_| Error::Storage)?;
            let key = hex::encode(Sha256::digest(bytes));
            let style_key = hex::encode(Sha256::digest(
                serde_json::to_vec(&(
                    self.renderer.profile(),
                    &input.template_sha256,
                    &spec.title,
                    &spec.bullets,
                    &spec.layout,
                    &spec.design,
                ))
                .map_err(|_| Error::Storage)?,
            ));
            let cached = self
                .store
                .cached_slide(scope.project_id, key.clone())
                .await?;
            let cached = match cached {
                Some(item) if self.cached_intact(&item).await => Some(item),
                _ => None,
            };
            let reused = cached.is_some();
            let item = if let Some(cached) = cached {
                cached
            } else {
                let typography = if input.repair {
                    None
                } else {
                    self.store
                        .render_style(scope.project_id, style_key.clone())
                        .await?
                };
                let output = self
                    .renderer
                    .render(
                        RenderInput {
                            specs: vec![(*id, spec.clone())],
                            template_sha256: input.template_sha256.clone(),
                            references: input.references.clone(),
                            media: input.media.clone(),
                            repair: input.repair,
                            typography,
                            offset: position,
                        },
                        cancel.clone(),
                    )
                    .await;
                match output {
                    Ok(out) => CachedSlide {
                        output: out.rendered.output,
                        preview: out
                            .rendered
                            .previews
                            .into_iter()
                            .next()
                            .ok_or(Error::Storage)?,
                        report: out.report,
                        layers: out.layers,
                    },
                    Err(Error::Quality(report)) => {
                        self.store
                            .check_slide(SlideCheck {
                                scope: scope.clone(),
                                slide_id: *id,
                                position: position as i64 + 1,
                                key,
                                style_key,
                                report: report.clone(),
                                rendered: None,
                                reused: false,
                            })
                            .await?;
                        return Err(Error::Quality(report));
                    }
                    Err(e) => return Err(e),
                }
            };
            self.store
                .check_slide(SlideCheck {
                    scope: scope.clone(),
                    slide_id: *id,
                    position: position as i64 + 1,
                    key,
                    style_key,
                    report: item.report.clone(),
                    rendered: Some(item.clone()),
                    reused,
                })
                .await?;
            parts.push(item.output);
            previews.push(item.preview);
        }
        let output = self.renderer.assemble(parts, cancel.clone()).await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        Ok(Rendered { output, previews })
    }
}
