// Purpose: Resume presentation writing checkpoints and publish validated editable output.
// Pattern: One bounded worker with heartbeat, cancellation and immutable per-slide specs.
// Usage: Application starts and joins the worker; the renderer owns tool subprocesses.
// Related: model.rs, adapters/sqlite/presentations/, adapters/processes/presentations.rs.
use super::*;
use std::time::Duration;
impl Presentations {
    pub fn start(
        &self,
        stop: CancellationToken,
        engine: crate::workflows::engine::Engine,
    ) -> tokio::task::JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            let maintenance_stop = stop.child_token();
            let cleanup_stop = maintenance_stop.clone();
            let store = this.store.clone();
            let maintenance = tokio::spawn(async move {
                let mut timer = tokio::time::interval(Duration::from_secs(60));
                timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {()=cleanup_stop.cancelled()=>break,_=timer.tick()=>{if let Err(e)=store.expire_editors(false).await{tracing::warn!(%e,"editor cache cleanup failed");}}}
                }
            });
            loop {
                if stop.is_cancelled() {
                    break;
                }
                engine
                    .tick(
                        super::edit_execution::EditDriver(this.clone()),
                        stop.clone(),
                    )
                    .await;
                if stop.is_cancelled() {
                    break;
                }
                engine.tick(this.clone(), stop.clone()).await;
                tokio::select! {()=stop.cancelled()=>break,()=tokio::time::sleep(Duration::from_millis(400))=>{}}
            }
            maintenance_stop.cancel();
            let _ = maintenance.await;
        })
    }
    pub(super) async fn write_slides(
        &self,
        r: &Run,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        if r.runtime_profile != self.renderer.profile() {
            return Err(Error::Processing("runtime_changed"));
        }
        let mut layouts: Option<Vec<CanvasLayout>> = None;
        while let Some(mut plan) = self.store.plan(r.clone()).await? {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if layouts.is_none() {
                let hash = self
                    .store
                    .canvas_source(r.project_id, None, Some(r.id))
                    .await?;
                layouts = Some(if hash.is_some() {
                    self.renderer.layouts(hash).await?
                } else {
                    vec![]
                });
            }
            plan.layouts = layouts.clone().unwrap_or_default();
            if plan.first && !plan.layouts.is_empty() {
                plan.materials = self
                    .store
                    .generation_materials(r.clone())
                    .await?
                    .into_iter()
                    .filter(|m| !["slide", "page"].contains(&m.kind.as_str()))
                    .collect();
            }
            template_authoring::prepare(&mut plan)?;
            let response = self
                .inference
                .pinned_json(
                    r.config_id.ok_or(Error::NotReady)?,
                    model::input(&plan)?,
                    cancel.clone(),
                )
                .await
                .map_err(|e| match e {
                    crate::modules::inference::Error::Cancelled => Error::Cancelled,
                    e => Error::Processing(e.code()),
                })?;
            let spec = model::validate(&plan, &response.text)?;
            let blob = self
                .assets
                .publish(
                    serde_json::to_vec(&spec).map_err(|_| Error::Storage)?,
                    crate::modules::assets::DerivedFormat::Binary,
                )
                .await
                .map_err(|_| Error::Storage)?;
            self.store
                .checkpoint(
                    r.clone(),
                    plan.slide_id,
                    blob,
                    spec.block_ids,
                    response.record.id,
                    spec.objects
                        .iter()
                        .filter_map(|o| {
                            if let ObjectContent::Reference { reference_id } = &o.content {
                                Some(*reference_id)
                            } else {
                                None
                            }
                        })
                        .collect(),
                )
                .await?;
        }
        self.generation_references(r).await
    }
    pub(super) async fn render_deck(
        &self,
        r: &Run,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        if let Some(cached) = self.store.cached_render(r.clone()).await? {
            return self.store.store_render(r.clone(), cached).await;
        }
        let template_sha256 = self.store.render_source(r.clone()).await?;
        let specs = self
            .slides(r.project_id, r.id)
            .await?
            .into_iter()
            .map(|s| s.spec.map(|spec| (s.id, spec)).ok_or(Error::Storage))
            .collect::<Result<Vec<_>, _>>()?;
        let repair = self.store.render_policy(r.clone()).await?;
        let rendered = self
            .render_checked(
                RenderScope {
                    project_id: r.project_id,
                    job_id: r.id,
                    lease: r.lease.clone().ok_or(Error::Cancelled)?,
                    editing: false,
                },
                RenderInput {
                    typography: None,
                    repair,
                    offset: 0,
                    specs,
                    template_sha256,
                    references: self.store.imports(r.project_id).await?,
                    media: self.store.media(r.project_id).await?,
                },
                cancel.clone(),
            )
            .await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store.store_render(r.clone(), rendered).await
    }
}
