// Purpose: Own deterministic canvas edits and template-based blank presentation admission.
// Pattern: Typed commands transform immutable Specs; SQLite conditionally commits a render-only revision.
// Usage: Direct pointer/keyboard edits never call a model and share the existing publication/undo engine.
// Related: sqlite/presentations/canvas.rs, manual.rs, frontend/features/presentations/canvas-api.ts.
use super::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SlideDesign {
    pub layout_key: String,
    pub authored: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ObjectPlacement {
    pub object_id: String,
    pub frame: Frame,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CanvasOperation {
    Geometry { placements: Vec<ObjectPlacement> },
    Insert { object: SlideObject },
    Text { object_id: String, text: String },
    AddSlide { layout_key: String },
    DuplicateSlide,
    DeleteSlide,
    MoveSlide { position: i64 },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CanvasCommand {
    pub expected_version: i64,
    pub slide_id: Uuid,
    pub session: Option<Uuid>,
    pub operation: CanvasOperation,
}
pub(crate) enum CanvasPlan {
    Replayed(Box<Run>),
    Build { spec_hash: String },
}
pub(crate) struct CanvasCommit {
    pub project: Uuid,
    pub base: Uuid,
    pub key: Uuid,
    pub input: CanvasCommand,
    pub spec: DerivedBlob,
    pub profile: String,
    pub media: Vec<Uuid>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BlankPresentation {
    pub title: String,
    pub template_job_id: Option<Uuid>,
    pub layout_key: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct CanvasLayout {
    pub key: String,
    pub name: String,
    pub slots: Vec<TemplateSlot>,
    pub preview_page: Option<i64>,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct TemplateSlot {
    pub id: String,
    pub max_chars: usize,
    pub font_size: f64,
    pub role: String,
    pub frame: Frame,
}
pub(crate) struct BlankCommit {
    pub project: Uuid,
    pub key: Uuid,
    pub input: BlankPresentation,
    pub spec: DerivedBlob,
    pub profile: String,
}
pub(crate) trait CanvasStore: Send + Sync {
    fn canvas_source(&self, p: Uuid, job: Option<Uuid>, run: Option<Uuid>) -> Work<Option<String>>;
    fn blank_replay(&self, p: Uuid, key: Uuid, input: BlankPresentation) -> Work<Option<Run>>;
    fn blank(&self, c: BlankCommit) -> Work<Run>;
    fn canvas_plan(&self, p: Uuid, run: Uuid, key: Uuid, input: CanvasCommand) -> Work<CanvasPlan>;
    fn canvas_commit(&self, c: CanvasCommit) -> Work<Run>;
}
impl Presentations {
    pub async fn canvas_layouts(
        &self,
        p: Uuid,
        job: Option<Uuid>,
        run: Option<Uuid>,
    ) -> Result<Vec<CanvasLayout>, Error> {
        if job.is_some() && run.is_some() {
            return Err(Error::Invalid);
        }
        let hash = self.store.canvas_source(p, job, run).await?;
        self.renderer.layouts(hash).await
    }
    pub async fn blank(
        &self,
        p: Uuid,
        key: Uuid,
        mut input: BlankPresentation,
    ) -> Result<Run, Error> {
        input.title = input.title.trim().into();
        if input.title.is_empty()
            || input.title.chars().count() > 120
            || input.layout_key.len() > 80
        {
            return Err(Error::Invalid);
        }
        if let Some(r) = self.store.blank_replay(p, key, input.clone()).await? {
            return Ok(r);
        }
        let layouts = self.canvas_layouts(p, input.template_job_id, None).await?;
        if !layouts.iter().any(|l| l.key == input.layout_key) {
            return Err(Error::Invalid);
        }
        let spec = blank_spec(&input.layout_key);
        let spec = self.publish_spec(&spec).await?;
        self.store
            .blank(BlankCommit {
                project: p,
                key,
                input,
                spec,
                profile: self.renderer.profile(),
            })
            .await
    }
    pub async fn canvas(
        &self,
        p: Uuid,
        base: Uuid,
        key: Uuid,
        input: CanvasCommand,
    ) -> Result<Run, Error> {
        if input.expected_version < 1 {
            return Err(Error::Invalid);
        }
        let plan = self.store.canvas_plan(p, base, key, input.clone()).await?;
        let CanvasPlan::Build { spec_hash } = plan else {
            if let CanvasPlan::Replayed(run) = plan {
                return Ok(*run);
            }
            unreachable!()
        };
        let mut spec = self.spec(spec_hash).await?;
        match &input.operation {
            CanvasOperation::Geometry { placements } => {
                if placements.is_empty() || placements.len() > 20 {
                    return Err(Error::EditInvalid);
                }
                let mut seen = std::collections::HashSet::new();
                for patch in placements {
                    if !seen.insert(&patch.object_id) {
                        return Err(Error::EditInvalid);
                    }
                    patch.frame.validate()?;
                    let object = spec
                        .objects
                        .iter_mut()
                        .find(|o| o.id == patch.object_id)
                        .ok_or(Error::EditInvalid)?;
                    object.frame = patch.frame.clone();
                }
            }
            CanvasOperation::Insert { object } => {
                if spec.objects.iter().any(|o| o.id == object.id)
                    || matches!(object.content, ObjectContent::Reference { .. })
                {
                    return Err(Error::EditInvalid);
                }
                if let ObjectContent::Image { media_id } = object.content
                    && !self.store.media(p).await?.iter().any(|m| m.id == media_id)
                {
                    return Err(Error::EditInvalid);
                }
                spec.objects.push(object.clone());
            }
            CanvasOperation::Text { object_id, text } => {
                let object = spec
                    .objects
                    .iter_mut()
                    .find(|o| &o.id == object_id)
                    .ok_or(Error::EditInvalid)?;
                let ObjectContent::Text { text: value, .. } = &mut object.content else {
                    return Err(Error::EditInvalid);
                };
                *value = text.clone();
            }
            CanvasOperation::AddSlide { layout_key } => {
                if !self
                    .canvas_layouts(p, None, Some(base))
                    .await?
                    .iter()
                    .any(|l| &l.key == layout_key)
                {
                    return Err(Error::Invalid);
                }
                spec = blank_spec(layout_key);
            }
            CanvasOperation::DuplicateSlide
            | CanvasOperation::DeleteSlide
            | CanvasOperation::MoveSlide { .. } => {}
        }
        spec.schema_version = spec.schema_version.max(2);
        authoring::validate_spec(&spec)?;
        let media = spec
            .objects
            .iter()
            .filter_map(|o| {
                if let ObjectContent::Image { media_id } = o.content {
                    Some(media_id)
                } else {
                    None
                }
            })
            .collect();
        let spec = self.publish_spec(&spec).await?;
        self.store
            .canvas_commit(CanvasCommit {
                project: p,
                base,
                key,
                input,
                spec,
                profile: self.renderer.profile(),
                media,
            })
            .await
    }
    async fn publish_spec(&self, spec: &SlideSpec) -> Result<DerivedBlob, Error> {
        self.assets
            .publish(
                serde_json::to_vec(spec).map_err(|_| Error::Storage)?,
                crate::modules::assets::DerivedFormat::Binary,
            )
            .await
            .map_err(|_| Error::Storage)
    }
}
fn blank_spec(key: &str) -> SlideSpec {
    SlideSpec {
        schema_version: 4,
        title: String::new(),
        bullets: vec![],
        notes: String::new(),
        block_ids: vec![],
        objects: vec![],
        layout: None,
        design: Some(SlideDesign {
            layout_key: key.into(),
            authored: true,
        }),
    }
}
