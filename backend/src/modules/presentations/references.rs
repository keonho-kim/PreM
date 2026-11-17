// Purpose: Insert pinned reference artwork or source slides into a new editable deck revision.
// Pattern: Read canonical choices, publish derived specs outside SQL, then conditionally commit.
// Usage: Explicit editor insertion; renderer and agents receive only registered reference IDs.
// Related: sqlite/presentations/references.rs, presentation-references.py, V27 migration.
use super::*;
use crate::modules::assets::DerivedFormat;
use serde::{Deserialize, Serialize};
#[derive(Serialize)]
pub(crate) struct MaterialSource {
    pub item_version: i64,
    pub file_version: i64,
    pub page_id: Uuid,
    pub id: Uuid,
    pub job_id: Uuid,
    pub item_id: Uuid,
    pub source_kind: String,
    pub title: String,
    pub kind: String,
    pub preview: Option<String>,
    pub available: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MaterialChoice {
    pub job_id: Uuid,
    pub material_id: Uuid,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InsertMaterials {
    pub expected_version: i64,
    #[serde(default)]
    pub session: Option<Uuid>,
    pub slide_id: Uuid,
    pub items: Vec<MaterialChoice>,
}
#[derive(Clone, Serialize)]
pub(crate) struct ImportedMaterial {
    pub id: Uuid,
    pub job_id: Uuid,
    pub material_id: Uuid,
    pub title: String,
    pub kind: String,
    pub source_hash: String,
    pub source_page: Option<i64>,
    pub locator: Option<crate::modules::documents::NativeLocator>,
    pub preview: Option<String>,
    pub text: Option<String>,
}
pub(crate) enum InsertionPlan {
    Replayed(Box<Run>),
    Build {
        spec_hash: String,
        items: Vec<ImportedMaterial>,
    },
}
pub(crate) struct InsertedSpec {
    pub blob: DerivedBlob,
    pub reference_ids: Vec<Uuid>,
    pub whole_slide: bool,
}
impl Presentations {
    pub async fn material_sources(
        &self,
        p: Uuid,
        r: Uuid,
        s: Uuid,
    ) -> Result<Vec<MaterialSource>, Error> {
        self.store.material_sources(p, r, s).await
    }

    pub async fn insert_materials(
        &self,
        p: Uuid,
        r: Uuid,
        key: Uuid,
        i: InsertMaterials,
    ) -> Result<Run, Error> {
        if i.items.is_empty() || i.items.len() > 10 || i.expected_version < 1 {
            return Err(Error::EditInvalid);
        }
        let plan = self.store.insertion_plan(p, r, key, &i).await?;
        let (spec_hash, items) = match plan {
            InsertionPlan::Replayed(run) => return Ok(*run),
            InsertionPlan::Build { spec_hash, items } => (spec_hash, items),
        };
        let source_specs = self.reference_specs(spec_hash, &items).await?;
        self.store
            .insert_materials(InsertionCommit {
                project_id: p,
                base_run: r,
                key,
                input: i,
                items,
                specs: source_specs,
                profile: self.renderer.profile(),
            })
            .await
    }
    pub(super) async fn generation_references(&self, r: &Run) -> Result<(), Error> {
        if let Some((hash, mut items)) = self.store.generation_imports(r.clone()).await? {
            let used: std::collections::HashSet<_> = self
                .slides(r.project_id, r.id)
                .await?
                .into_iter()
                .filter_map(|s| s.spec)
                .flat_map(|s| s.objects)
                .filter_map(|o| {
                    if let ObjectContent::Reference { reference_id } = o.content {
                        Some(reference_id)
                    } else {
                        None
                    }
                })
                .collect();
            items.retain(|m| ["slide", "page"].contains(&m.kind.as_str()) || !used.contains(&m.id));
            let specs = self.reference_specs(hash, &items).await?;
            self.store
                .apply_generation_imports(r.clone(), specs)
                .await?;
        }
        Ok(())
    }
    async fn reference_specs(
        &self,
        spec_hash: String,
        items: &[ImportedMaterial],
    ) -> Result<Vec<InsertedSpec>, Error> {
        let mut target = self.spec(spec_hash).await?;
        let mut source_specs = vec![];
        let count = items
            .iter()
            .filter(|i| !["slide", "page"].contains(&i.kind.as_str()))
            .count();
        let columns = if count > 2 { 2 } else { 1 };
        let rows = count.div_ceil(columns).max(1);
        let mut placed = 0;
        let mut ids = vec![];
        for item in items {
            let whole = ["slide", "page"].contains(&item.kind.as_str());
            let mut object = SlideObject {
                id: format!("ref-{}", item.id.simple()),
                name: item.title.chars().take(60).collect(),
                frame: Frame {
                    x: if whole { 0. } else { 15. },
                    y: if whole { 0. } else { 30. },
                    width: if whole { 100. } else { 70. },
                    height: if whole { 100. } else { 55. },
                    rotation: 0.,
                },
                content: ObjectContent::Reference {
                    reference_id: item.id,
                },
            };
            if whole {
                let spec = SlideSpec {
                    design: None,
                    schema_version: 3,
                    title: item.title.chars().take(60).collect(),
                    bullets: vec![],
                    notes: String::new(),
                    block_ids: vec![],
                    objects: vec![object],
                    layout: None,
                };
                source_specs.push(self.insertion_spec(spec, vec![item.id], true).await?);
            } else {
                object.frame = Frame {
                    x: 55. + (placed % columns) as f64 * 21.,
                    y: 30. + (placed / columns) as f64 * (55. / rows as f64),
                    width: if columns == 2 { 19. } else { 40. },
                    height: (55. / rows as f64) - 2.,
                    rotation: 0.,
                };
                placed += 1;
                target.objects.push(object);
                ids.push(item.id);
            }
        }
        if !ids.is_empty() {
            target.schema_version = target.schema_version.max(3);
            if target.layout.is_none() && target.design.is_none() {
                target.layout = Some(Layout {
                    title: Frame {
                        x: 5.,
                        y: 10.,
                        width: 90.,
                        height: 15.,
                        rotation: 0.,
                    },
                    body: Frame {
                        x: 5.,
                        y: 30.,
                        width: 43.,
                        height: 60.,
                        rotation: 0.,
                    },
                });
            }
            source_specs.insert(0, self.insertion_spec(target, ids, false).await?);
        }
        Ok(source_specs)
    }
    async fn insertion_spec(
        &self,
        spec: SlideSpec,
        reference_ids: Vec<Uuid>,
        whole_slide: bool,
    ) -> Result<InsertedSpec, Error> {
        super::model::validate_spec(&spec)?;
        let blob = self
            .assets
            .publish(
                serde_json::to_vec(&spec).map_err(|_| Error::Storage)?,
                DerivedFormat::Binary,
            )
            .await
            .map_err(|_| Error::Storage)?;
        Ok(InsertedSpec {
            blob,
            reference_ids,
            whole_slide,
        })
    }
}

pub(crate) struct InsertionCommit {
    pub project_id: Uuid,
    pub base_run: Uuid,
    pub key: Uuid,
    pub input: InsertMaterials,
    pub items: Vec<ImportedMaterial>,
    pub specs: Vec<InsertedSpec>,
    pub profile: String,
}
