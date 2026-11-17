// Purpose: Run bounded relation exploration under common-engine supervision.
// Pattern: Canonical search inputs/assessments stay with Relations; engine owns task lifetime.
// Usage: Independent one-slot search engine; model pairs retain their bounded parallelism.
// Related: worker.rs, sqlite/relations/execution.rs, RELATION definition.
use super::*;
use crate::workflows::{
    definitions::RELATION,
    engine::{Definition, Driver, Node},
};
use tokio_util::sync::CancellationToken;
impl Driver for Relations {
    type Job = Run;
    type Error = Error;
    fn definition(&self, _: &Run) -> Definition {
        RELATION
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
    fn execute(&self, r: Run, n: Node, c: CancellationToken) -> Work<()> {
        let this = self.clone();
        Box::pin(async move {
            match n.key {
                "review" => this.review(&r, c).await,
                "publish" => this.store.finish(r, "succeeded".into(), None).await,
                _ => Err(Error::Model("workflow_incompatible")),
            }
        })
    }
    fn fail(&self, r: Run, e: Option<Error>) -> Work<()> {
        let (s, c) = match e {
            None | Some(Error::Cancelled) => ("queued", "interrupted"),
            Some(Error::Model(c)) => ("failed", c),
            _ => ("failed", "relation_search_failed"),
        };
        let store = self.store.clone();
        Box::pin(async move {
            let current = store.get(r.project_id, Some(r.id)).await?;
            if !current.is_some_and(|now| now.status == "running" && now.lease == r.lease) {
                return Ok(());
            }
            store.finish(r, s.into(), Some(c.into())).await
        })
    }
}
