// Purpose: Schedule document/template execution through the common engine with two bounded lanes.
// Pattern: App owns engine admission; all parsing and inference stays outside database transactions.
// Usage: Application joins these workers before closing providers and storage.
// Related: execution.rs, classification.rs, workflows/engine/.
use super::*;
use tokio_util::sync::CancellationToken;
impl Documents {
    pub fn start(
        &self,
        stop: CancellationToken,
        engine: crate::workflows::engine::Engine,
    ) -> tokio::task::JoinHandle<()> {
        let service = self.clone();
        tokio::spawn(async move {
            let mut tasks = tokio::task::JoinSet::new();
            for _ in 0..2 {
                let service = service.clone();
                let stop = stop.clone();
                let engine = engine.clone();
                tasks.spawn(async move {
                    while !stop.is_cancelled() {
                        engine.tick(service.clone(), stop.clone()).await;
                        tokio::select! {
                            () = stop.cancelled() => break,
                            () = tokio::time::sleep(std::time::Duration::from_millis(800)) => {}
                        }
                    }
                });
            }
            while let Some(result) = tasks.join_next().await {
                if let Err(e) = result {
                    tracing::error!(%e,"document scheduler terminated");
                }
            }
        })
    }
    #[tracing::instrument(skip_all, fields(job_id = %job.id, format = %job.format))]
    pub(super) async fn extract_job(
        &self,
        mut job: Job,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        if job.kind == "templates" {
            if self
                .detail(job.kind.clone(), job.item_id, Some(job.id))
                .await?
                .template
                .is_some()
            {
                return Ok(());
            }

            let input = crate::modules::templates::Input {
                job_id: job.id,
                lease: job.lease.clone().ok_or(Error::Storage)?,
                source_sha256: job.source_sha256.clone(),
                profile: job.profile.clone(),
            };
            self.templates
                .extract(input, cancel.clone())
                .await
                .map_err(|e| match e {
                    crate::modules::templates::Error::Cancelled => Error::Cancelled,
                    crate::modules::templates::Error::TimedOut => {
                        Error::Processing("document_step_timeout")
                    }
                    crate::modules::templates::Error::MissingRuntime => {
                        Error::Processing("template_runtime_missing")
                    }
                    _ => Error::Processing("template_extract_failed"),
                })?;
            return Ok(());
        }
        if job.extraction_id.is_none() {
            job.extraction_id = self.store.restore_extraction(job.clone()).await?;
            if job.extraction_id.is_none() {
                let result = self.extractor.extract(job.clone(), cancel.clone()).await?;
                self.store.extraction(job.clone(), result).await?;
            }
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        Ok(())
    }
}
