// Purpose: Supervise chat proposal and preview rendering through the common durable engine.
// Pattern: Narrow driver wrapper separates edit jobs from generation jobs in the same feature.
// Usage: One shared PPT processing slot; explicit approval subsequently queues normal publication.
// Related: edits.rs, preview.rs, sqlite/presentations/edits/execution.rs.
use super::*;
use crate::workflows::{
    definitions::SLIDE_EDIT,
    engine::{Definition, Driver, Node},
};
#[derive(Clone)]
pub(super) struct EditDriver(pub Presentations);
impl Driver for EditDriver {
    type Job = Edit;
    type Error = Error;
    fn definition(&self, _: &Edit) -> Definition {
        SLIDE_EDIT
    }
    fn claim(&self) -> Work<Option<Edit>> {
        self.0.store.claim_edit()
    }
    fn heartbeat(&self, e: Edit) -> Work<bool> {
        self.0.store.edit_heartbeat(e)
    }
    fn begin(&self, e: Edit, n: Node) -> Work<bool> {
        self.0.store.edit_begin_node(e, n)
    }
    fn finish(&self, e: Edit, n: Node) -> Work<()> {
        self.0.store.edit_finish_node(e, n)
    }
    fn execute(&self, e: Edit, n: Node, c: CancellationToken) -> Work<()> {
        let service = self.0.clone();
        Box::pin(async move {
            if e.runtime_profile != service.renderer.profile() {
                return Err(Error::Processing("runtime_changed"));
            }
            match n.key {
                "propose" => service.propose_targets(&e, c).await,
                "render" => service.prepare_edit_preview(&e, c).await,
                _ => Err(Error::Processing("workflow_incompatible")),
            }
        })
    }
    fn fail(&self, e: Edit, error: Option<Error>) -> Work<()> {
        let code = match error {
            None | Some(Error::Cancelled) => "interrupted",
            Some(Error::Conflict) => "inputs_changed",
            Some(Error::Processing(c)) => c,
            Some(Error::Quality(_)) => "slide_quality_failed",
            _ => "edit_failed",
        };
        self.0.store.edit_fail(e, code.into())
    }
}
