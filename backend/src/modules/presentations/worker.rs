// Purpose: Resume presentation writing checkpoints and publish validated editable output.
// Pattern: One bounded worker with heartbeat, cancellation and immutable per-slide specs.
// Usage: Application starts and joins the worker; the renderer owns tool subprocesses.
// Related: model.rs, adapters/sqlite/presentations/, adapters/processes/presentations.rs.
use super::*;
use std::time::Duration;
impl Presentations {
    pub fn start(&self, stop: CancellationToken) -> tokio::task::JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                if stop.is_cancelled() {
                    break;
                }
                this.process_edit(stop.clone()).await;
                if stop.is_cancelled() {
                    break;
                }
                match this.store.claim().await {
                    Ok(Some(run)) => this.execute(run, stop.clone()).await,
                    Ok(None) => {}
                    Err(e) => tracing::warn!(%e,"presentation scheduler failed"),
                }
                tokio::select! {()=stop.cancelled()=>break,()=tokio::time::sleep(Duration::from_millis(400))=>{}}
            }
        })
    }
    async fn execute(&self, run: Run, stop: CancellationToken) {
        let cancel = stop.child_token();
        let token = cancel.clone();
        let store = self.store.clone();
        let watched = run.clone();
        let monitor = tokio::spawn(async move {
            loop {
                tokio::select! {()=token.cancelled()=>break,()=tokio::time::sleep(Duration::from_secs(2))=>{if !matches!(store.heartbeat(watched.clone()).await,Ok(true)){token.cancel();break}}}
            }
        });
        let result = self.generate(&run, cancel.clone()).await;
        cancel.cancel();
        let _ = monitor.await;
        if let Err(e) = result {
            let code = match e {
                Error::Cancelled => "interrupted",
                Error::Conflict => "inputs_changed",
                Error::Processing(c) => c,
                _ => "generation_failed",
            };
            let _ = self.store.fail(run, code.into()).await;
        }
    }
    async fn generate(&self, r: &Run, cancel: CancellationToken) -> Result<(), Error> {
        if r.runtime_profile != self.renderer.profile() {
            return Err(Error::Processing("runtime_changed"));
        }
        while let Some(plan) = self.store.plan(r.clone()).await? {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let response = self
                .inference
                .pinned_json(r.config_id, model::input(&plan)?, cancel.clone())
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
                )
                .await?;
        }
        let template_sha256 = self.store.render_source(r.clone()).await?;
        let specs = self
            .slides(r.project_id, r.id)
            .await?
            .into_iter()
            .map(|s| s.spec.map(|spec| (s.id, spec)).ok_or(Error::Storage))
            .collect::<Result<Vec<_>, _>>()?;
        let rendered = self
            .renderer
            .render(
                RenderInput {
                    specs,
                    template_sha256,
                },
                cancel.clone(),
            )
            .await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store.complete(r.clone(), rendered).await
    }
}
