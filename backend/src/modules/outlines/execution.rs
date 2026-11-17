// Purpose: Bind outline generation and content mapping to versioned common-engine nodes.
// Pattern: Domain owns pinned model batches and revision commits; engine supervises lifetime.
// Usage: One app-owned execution slot; complete batches survive cancellation and restart.
// Related: worker.rs, sqlite/outlines/execution.rs, workflows/definitions/.
use super::*;
use crate::workflows::{
    definitions::{MAPPING, OUTLINE},
    engine::{Definition, Driver, Node},
};
use tokio_util::sync::CancellationToken;
impl Driver for Outlines {
    type Job = Run;
    type Error = Error;
    fn definition(&self, run: &Run) -> Definition {
        if run.kind == "map" { MAPPING } else { OUTLINE }
    }
    fn claim(&self) -> Work<Option<Run>> {
        self.store.claim()
    }
    fn heartbeat(&self, r: Run) -> Work<bool> {
        self.store.heartbeat(r)
    }
    fn begin(&self, r: Run, n: Node) -> Work<bool> {
        self.store.begin_node(r, n)
    }
    fn finish(&self, r: Run, n: Node) -> Work<()> {
        self.store.finish_node(r, n)
    }
    fn execute(&self, r: Run, n: Node, stop: CancellationToken) -> Work<()> {
        let this = self.clone();
        Box::pin(async move {
            match n.key {
                "compose" | "map" => this.execute_batches(&r, stop).await,
                "publish" => this.store.complete(r).await,
                _ => Err(Error::Model("workflow_incompatible")),
            }
        })
    }
    fn fail(&self, r: Run, error: Option<Error>) -> Work<()> {
        let code = match error {
            None | Some(Error::Cancelled) => "interrupted",
            Some(Error::Conflict) => "inputs_changed",
            Some(Error::Model(code)) => code,
            Some(Error::Invalid) => "invalid_model_response",
            _ => "outline_failed",
        };
        self.store.fail(r, code.into())
    }
}
