// Purpose: Bind PPT domain handlers to the common durable execution engine.
// Pattern: Feature errors/checkpoints stay owned here; engine controls scheduling and heartbeat.
// Usage: Presentation worker supplies one driver with a bounded execution permit.
// Related: workflows/engine/, worker.rs, sqlite/presentations/execution.rs.
use super::*;
use crate::workflows::{
    definitions::PRESENTATION,
    engine::{Definition, Driver, Node},
};
impl Driver for Presentations {
    type Job = Run;
    type Error = Error;
    fn definition(&self, _job: &Self::Job) -> Definition {
        PRESENTATION
    }
    fn claim(&self) -> Work<Option<Run>> {
        let store = self.store.clone();
        Box::pin(async move { store.claim().await })
    }
    fn heartbeat(&self, r: Run) -> Work<bool> {
        let store = self.store.clone();
        Box::pin(async move { store.heartbeat(r).await })
    }
    fn begin(&self, r: Run, n: Node) -> Work<bool> {
        let store = self.store.clone();
        Box::pin(async move { store.begin_node(r, n).await })
    }
    fn finish(&self, r: Run, n: Node) -> Work<()> {
        let store = self.store.clone();
        Box::pin(async move { store.finish_node(r, n).await })
    }
    fn execute(&self, r: Run, n: Node, cancel: CancellationToken) -> Work<()> {
        let this = self.clone();
        Box::pin(async move {
            if r.runtime_profile != this.renderer.profile() {
                return Err(Error::Processing("runtime_changed"));
            }
            match n.key {
                "write" => this.write_slides(&r, cancel).await,
                "render" => this.render_deck(&r, cancel).await,
                "publish" => {
                    let rendered = this
                        .store
                        .rendered(r.clone())
                        .await?
                        .ok_or(Error::Storage)?;
                    this.store.complete(r, rendered).await
                }
                _ => Err(Error::Processing("workflow_incompatible")),
            }
        })
    }
    fn fail(&self, r: Run, e: Option<Error>) -> Work<()> {
        let store = self.store.clone();
        Box::pin(async move {
            let code = match e {
                None | Some(Error::Cancelled) => "interrupted",
                Some(Error::Conflict) => "inputs_changed",
                Some(Error::Processing(c)) => c,
                Some(Error::Quality(_)) => "slide_quality_failed",
                _ => "generation_failed",
            };
            store.fail(r, code.into()).await
        })
    }
}
