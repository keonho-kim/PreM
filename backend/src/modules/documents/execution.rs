// Purpose: Bind document/template stages to the common engine without duplicating job state.
// Pattern: Engine supervises lifetime; each handler reloads the canonical checkpoint under its lease.
// Usage: Two document lanes; templates use a separate graph and never invoke content decisions.
// Related: worker.rs, classification.rs, sqlite/documents/execution.rs.
use super::*;
use crate::workflows::{
    definitions::{DOCUMENT, TEMPLATE},
    engine::{Definition, Driver, Node},
};
use tokio_util::sync::CancellationToken;
impl Driver for Documents {
    type Job = Job;
    type Error = Error;
    fn definition(&self, j: &Job) -> Definition {
        if j.kind == "templates" {
            TEMPLATE
        } else {
            DOCUMENT
        }
    }
    fn claim(&self) -> Work<Option<Job>> {
        let this = self.clone();
        Box::pin(async move {
            this.store.scan_uploads(this.extractor.profile()).await?;
            this.store.claim().await
        })
    }
    fn heartbeat(&self, j: Job) -> Work<bool> {
        let store = self.store.clone();
        Box::pin(async move {
            let Some(lease) = j.lease else {
                return Ok(false);
            };
            store.heartbeat(j.id, lease).await
        })
    }
    fn begin(&self, j: Job, n: Node) -> Work<bool> {
        let store = self.store.clone();
        Box::pin(async move { store.begin_node(j, n).await })
    }
    fn finish(&self, j: Job, n: Node) -> Work<()> {
        let store = self.store.clone();
        Box::pin(async move { store.finish_node(j, n).await })
    }
    fn execute(&self, j: Job, n: Node, cancel: CancellationToken) -> Work<()> {
        let this = self.clone();
        Box::pin(async move {
            let fresh = this.store.current_job(j.id).await?;
            if fresh.lease != j.lease {
                return Err(Error::Cancelled);
            }
            tracing::info!(job_id = %j.id, stage = n.key, attempt = j.attempt, format = %j.format, "document stage started");
            let result = match n.key {
                "extract" => this.extract_job(fresh, cancel).await,
                "classify" => this.classify_job(fresh, cancel).await,
                "ready" => {
                    this.store
                        .finish(fresh, "succeeded".into(), None, false)
                        .await
                }
                _ => Err(Error::Processing("workflow_incompatible")),
            };
            match &result {
                Ok(()) => tracing::info!(job_id = %j.id, stage = n.key, "document stage finished"),
                Err(Error::WaitingConfiguration) => {
                    tracing::info!(job_id = %j.id, stage = n.key, "waiting for model configuration")
                }
                Err(error) => {
                    tracing::warn!(job_id = %j.id, stage = n.key, attempt = j.attempt, %error, "document stage stopped")
                }
            }
            result
        })
    }
    fn fail(&self, j: Job, e: Option<Error>) -> Work<()> {
        let store = self.store.clone();
        Box::pin(async move {
            let (status, code, retry) = match e {
                Some(Error::WaitingConfiguration) => return Ok(()),
                None | Some(Error::Cancelled) => ("failed", "interrupted", true),
                Some(Error::Processing(code)) => (
                    "failed",
                    code,
                    [
                        "provider_busy",
                        "provider_queue_timeout",
                        "provider_timeout",
                        "provider_unreachable",
                        "storage_unavailable",
                    ]
                    .contains(&code),
                ),
                Some(Error::Storage) => ("failed", "storage_unavailable", false),
                _ => ("failed", "processing_failed", false),
            };
            let current = store.current_job(j.id).await?;
            if current.lease != j.lease
                || !["extracting", "classifying"].contains(&current.status.as_str())
            {
                return Ok(());
            }
            store
                .finish(j, status.into(), Some(code.into()), retry)
                .await
        })
    }
}
