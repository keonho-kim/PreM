// Purpose: Own durable slide-scoped chat proposals and explicit apply/reject/retry commands.
// Pattern: One bounded editing pass per worker tick, with pinned model and immutable base input.
// Usage: Presentations facade; runtime reads/rendering reuse existing feature ports.
// Related: edit_types.rs, edit_model.rs, adapters/sqlite/presentations/edits/.
use super::*;
impl Presentations {
    pub async fn edit(
        &self,
        p: Uuid,
        run: Uuid,
        slide: Uuid,
        key: Uuid,
        mut input: EditRequest,
    ) -> Result<EditView, Error> {
        input.prompt = input.prompt.trim().into();
        input.fields.sort();
        if input.prompt.is_empty()
            || input.prompt.chars().count() > 2000
            || input.fields.is_empty()
            || input.fields.len() > 5
            || input
                .fields
                .iter()
                .any(|f| !["title", "bullets", "notes", "objects", "layout"].contains(&f.as_str()))
            || input.fields.windows(2).any(|f| f[0] == f[1])
            || input.expected_version < 1
            || input.model_version.is_some_and(|v| v < 1)
            || input.connection_id.is_some() != input.model_version.is_some()
        {
            return Err(Error::EditInvalid);
        }
        input.slide_ids.sort();
        if input.slide_ids.len() > 24
            || input.slide_ids.windows(2).any(|s| s[0] == s[1])
            || input.object_ids.len() > 20
            || input
                .object_ids
                .iter()
                .any(|s| s.is_empty() || s.len() > 64)
            || (!input.object_ids.is_empty() && input.fields != ["objects"])
        {
            return Err(Error::EditInvalid);
        }
        let edit = self
            .store
            .create_edit(p, run, slide, key, input, self.renderer.profile())
            .await?;
        self.edit_view(edit).await
    }
    pub async fn edits(&self, p: Uuid, run: Uuid, slide: Uuid) -> Result<Vec<EditView>, Error> {
        let mut out = vec![];
        for edit in self.store.edits(p, run, slide).await? {
            out.push(self.edit_view(edit).await?);
        }
        Ok(out)
    }
    pub async fn edit_command(
        &self,
        p: Uuid,
        id: Uuid,
        key: Uuid,
        v: i64,
        action: String,
        session: Option<Uuid>,
    ) -> Result<EditView, Error> {
        if !["apply", "reject", "cancel", "retry"].contains(&action.as_str()) {
            return Err(Error::EditInvalid);
        }
        let edit = self
            .store
            .edit_command(p, id, key, v, action, session)
            .await?;
        self.edit_view(edit).await
    }
    pub(super) async fn spec(&self, hash: String) -> Result<SlideSpec, Error> {
        serde_json::from_slice(
            &self
                .assets
                .bytes(hash, 65536)
                .await
                .map_err(|_| Error::Storage)?,
        )
        .map_err(|_| Error::Storage)
    }
    async fn edit_view(&self, edit: Edit) -> Result<EditView, Error> {
        let before = self.spec(edit.source_spec.clone()).await?;
        let proposal = if let Some(hash) = edit.proposed_spec.clone() {
            Some(self.spec(hash).await?)
        } else {
            None
        };
        let mut slides = vec![];
        for t in &edit.targets {
            slides.push(EditSlideView {
                slide_id: t.slide_id,
                position: t.position,
                before: self.spec(t.source_spec.clone()).await?,
                proposal: if let Some(h) = &t.proposed_spec {
                    Some(self.spec(h.clone()).await?)
                } else {
                    None
                },
            });
        }
        Ok(EditView {
            edit,
            before,
            proposal,
            slides,
        })
    }
    pub(super) async fn propose_targets(
        &self,
        edit: &Edit,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        if edit.runtime_profile != self.renderer.profile() {
            return Err(Error::Processing("runtime_changed"));
        }
        for target in edit.targets.iter().filter(|t| !t.completed) {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let mut scoped = edit.clone();
            scoped.source_slide_id = target.slide_id;
            scoped.source_spec = target.source_spec.clone();
            scoped.object_ids = target.object_ids.clone();
            self.propose_target(&scoped, edit, target, cancel.clone())
                .await?;
        }
        Ok(())
    }
    async fn propose_target(
        &self,
        scoped: &Edit,
        edit: &Edit,
        target: &EditTarget,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let original = self.spec(target.source_spec.clone()).await?;
        let mut scoped = scoped.clone();
        let used: std::collections::HashSet<_> = original
            .objects
            .iter()
            .filter_map(|o| {
                if let ObjectContent::Reference { reference_id } = &o.content {
                    Some(*reference_id)
                } else {
                    None
                }
            })
            .collect();
        let words: Vec<_> = edit
            .prompt
            .split_whitespace()
            .filter(|w| w.chars().count() > 1)
            .collect();
        scoped.references.sort_by_key(|r| {
            !words.iter().any(|w| r.title.contains(w))
                && !(r.kind == "chart" && edit.prompt.contains("차트"))
        });
        let mut candidates = 0;
        scoped.references.retain(|r| {
            if used.contains(&r.id) {
                true
            } else {
                candidates += 1;
                candidates <= 12
            }
        });
        let context = self.store.edit_context(scoped.clone()).await?;
        let plan = EditPlan { context, original };
        let reply = self
            .inference
            .pinned_json(
                edit.config_id,
                super::edit_model::input(&scoped, &plan)?,
                cancel.clone(),
            )
            .await
            .map_err(|e| match e {
                crate::modules::inference::Error::Cancelled => Error::Cancelled,
                e => Error::Processing(e.code()),
            })?;
        let output = super::edit_model::validate(&scoped, &plan, &reply.text)?;
        let media = output
            .spec
            .objects
            .iter()
            .filter_map(|o| {
                if let ObjectContent::Image { media_id } = &o.content {
                    Some(*media_id)
                } else {
                    None
                }
            })
            .collect();
        let blob = self
            .assets
            .publish(
                serde_json::to_vec(&output.spec).map_err(|_| Error::Storage)?,
                crate::modules::assets::DerivedFormat::Binary,
            )
            .await
            .map_err(|_| Error::Storage)?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store
            .edit_ready(
                edit.clone(),
                target.slide_id,
                blob,
                output.message,
                reply.record.id,
                UsedAssets {
                    media,
                    references: output
                        .spec
                        .objects
                        .iter()
                        .filter_map(|o| {
                            if let ObjectContent::Reference { reference_id } = &o.content {
                                Some(*reference_id)
                            } else {
                                None
                            }
                        })
                        .collect(),
                },
            )
            .await
    }
}
