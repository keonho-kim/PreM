// Purpose: Execute durable outline batches and resume only missing checkpoints.
// Pattern: One owned worker, shared model admission, heartbeat cancellation and lease-fenced commits.
// Usage: Application starts/stops this worker alongside document and relation workers.
// Related: model.rs, adapters/sqlite/outlines/jobs.rs, model_execution/.
use super::*;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
impl Outlines {
    pub fn start(
        &self,
        stop: CancellationToken,
        engine: crate::workflows::engine::Engine,
    ) -> tokio::task::JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            while !stop.is_cancelled() {
                engine.tick(this.clone(), stop.clone()).await;
                tokio::select! {
                    () = stop.cancelled() => break,
                    () = tokio::time::sleep(Duration::from_millis(400)) => {}
                }
            }
        })
    }
    pub(super) async fn execute_batches(
        &self,
        run: &Run,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        while let Some(plan) = self.store.plan(run.clone()).await? {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let input = model::input(run, &plan)?;
            let output = self
                .inference
                .pinned_json(run.config_id, input, cancel.clone())
                .await
                .map_err(|e| match e {
                    crate::modules::inference::Error::Cancelled => Error::Cancelled,
                    other => Error::Model(other.code()),
                })?;
            let result = model::validate(&run.kind, &plan, &output.text)?;
            self.store
                .checkpoint(run.clone(), plan.batch, result, output.record.id)
                .await?;
        }
        Ok(())
    }
}
