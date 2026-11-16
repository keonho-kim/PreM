// Purpose: Execute durable outline batches and resume only missing checkpoints.
// Pattern: One owned worker, shared model admission, heartbeat cancellation and lease-fenced commits.
// Usage: Application starts/stops this worker alongside document and relation workers.
// Related: model.rs, adapters/sqlite/outlines/jobs.rs, model_execution/.
use super::*;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
impl Outlines {
    pub fn start(&self, stop: CancellationToken) -> tokio::task::JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                if stop.is_cancelled() {
                    break;
                }
                match this.store.claim().await {
                    Ok(Some(run)) => {
                        this.run(run, stop.clone()).await;
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!(%e,"outline scheduling failed"),
                }
                tokio::select! {()=stop.cancelled()=>break,()=tokio::time::sleep(Duration::from_millis(400))=>{}}
            }
        })
    }
    async fn run(&self, run: Run, stop: CancellationToken) {
        let cancel = stop.child_token();
        let token = cancel.clone();
        let store = self.store.clone();
        let watched = run.clone();
        let monitor = tokio::spawn(async move {
            loop {
                tokio::select! {()=token.cancelled()=>break,()=tokio::time::sleep(Duration::from_secs(2))=>{if !matches!(store.heartbeat(watched.clone()).await,Ok(true)){token.cancel();break}}}
            }
        });
        let result = self.execute_run(&run, cancel.clone()).await;
        cancel.cancel();
        let _ = monitor.await;
        if let Err(error) = result {
            let code = match error {
                Error::Cancelled => "interrupted",
                Error::Conflict => "inputs_changed",
                Error::Model(code) => code,
                Error::Invalid => "invalid_model_response",
                _ => "outline_failed",
            };
            let _ = self.store.fail(run, code.into()).await;
        }
    }
    async fn execute_run(&self, run: &Run, cancel: CancellationToken) -> Result<(), Error> {
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
        self.store.complete(run.clone()).await
    }
}
