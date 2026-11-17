// Purpose: Schedule bounded work and supervise durable DAG execution, heartbeat and cancellation.
// Pattern: Consumer drivers supply I/O and handlers; committed checkpoints govern replay.
// Usage: App-owned workers invoke tick; no feature SQL or provider execution lives here.
// Related: graph.rs, modules/presentations/execution.rs, engine/tests.rs.
#[derive(Clone, Debug, serde::Serialize)]
pub(crate) struct Stage {
    pub key: String,
    pub state: String,
    pub attempt: i64,
}
mod graph;
#[cfg(test)]
mod tests;
pub(crate) use graph::{Definition, Node};
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;
pub(crate) type Work<T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send>>;
pub(crate) trait Driver: Clone + Send + Sync + 'static {
    type Job: Clone + Send + Sync + 'static;
    type Error: std::fmt::Display + Send + 'static;
    fn definition(&self, _job: &Self::Job) -> Definition;
    fn claim(&self) -> Work<Option<Self::Job>, Self::Error>;
    fn heartbeat(&self, job: Self::Job) -> Work<bool, Self::Error>;
    fn begin(&self, job: Self::Job, node: Node) -> Work<bool, Self::Error>;
    fn execute(&self, job: Self::Job, node: Node, stop: CancellationToken)
    -> Work<(), Self::Error>;
    fn finish(&self, job: Self::Job, node: Node) -> Work<(), Self::Error>;
    fn fail(&self, job: Self::Job, error: Option<Self::Error>) -> Work<(), Self::Error>;
}
#[derive(Clone)]
pub(crate) struct Engine {
    slots: Arc<tokio::sync::Semaphore>,
}
impl Engine {
    pub fn new(concurrency: std::num::NonZeroUsize) -> Self {
        Self {
            slots: Arc::new(tokio::sync::Semaphore::new(concurrency.get())),
        }
    }
    pub async fn tick<D: Driver>(&self, driver: D, stop: CancellationToken) {
        if stop.is_cancelled() {
            return;
        }
        let Ok(_permit) = self.slots.clone().try_acquire_owned() else {
            return;
        };
        let job = match driver.claim().await {
            Ok(Some(j)) => j,
            Ok(None) => return,
            Err(e) => {
                tracing::warn!(%e,"workflow claim failed");
                return;
            }
        };
        let cancel = stop.child_token();
        let watch_cancel = cancel.clone();
        let watch_driver = driver.clone();
        let watched = job.clone();
        let monitor = tokio::spawn(async move {
            loop {
                tokio::select! {()=watch_cancel.cancelled()=>break,()=tokio::time::sleep(Duration::from_secs(2))=>{if !matches!(watch_driver.heartbeat(watched.clone()).await,Ok(true)){watch_cancel.cancel();break;}}}
            }
        });
        let execution_driver = driver.clone();
        let execution_job = job.clone();
        let execution_stop = cancel.clone();
        let execution = tokio::spawn(async move {
            Self::run(&execution_driver, execution_job, execution_stop).await
        });
        let result = match execution.await {
            Ok(result) => result,
            Err(_) => {
                tracing::error!("workflow handler task terminated unexpectedly");
                Err(None)
            }
        };
        cancel.cancel();
        let _ = monitor.await;
        if let Err(error) = result
            && let Err(e) = driver.fail(job, error).await
        {
            tracing::warn!(%e,"workflow failure checkpoint failed");
        }
    }
    async fn run<D: Driver>(
        driver: &D,
        job: D::Job,
        stop: CancellationToken,
    ) -> Result<(), Option<D::Error>> {
        let definition = driver.definition(&job);
        // Definitions are authored constants and also tested; a malformed definition never calls work.
        if !definition.valid() {
            tracing::error!(definition = definition.key, "invalid workflow graph");
            return Err(None);
        }
        let mut done = vec![];
        while let Some(node) = definition.next(&done) {
            if stop.is_cancelled() {
                return Err(None);
            }
            if driver.begin(job.clone(), node).await.map_err(Some)? {
                driver
                    .execute(job.clone(), node, stop.clone())
                    .await
                    .map_err(Some)?;
                if stop.is_cancelled() {
                    return Err(None);
                }
                driver.finish(job.clone(), node).await.map_err(Some)?;
            }
            done.push(node.key);
        }
        Ok(())
    }
}
