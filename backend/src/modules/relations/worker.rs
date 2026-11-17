// Purpose: Resume durable searches and evaluate isolated native pairs or LLM groups with bounded parallel requests.
// Pattern: One search owner prevents duplicate concurrent cache fills; up to four requests run in parallel.
// Usage: Application starts/stops this worker with the document processing lifetime.
// Related: protocol.rs, Store, model_execution admission and cancellation.
use super::*;
use futures_util::{StreamExt, stream};
use tokio_util::sync::CancellationToken;
impl Relations {
    pub fn start(
        &self,
        stop: CancellationToken,
        engine: crate::workflows::engine::Engine,
    ) -> tokio::task::JoinHandle<()> {
        let service = self.clone();
        tokio::spawn(async move {
            while !stop.is_cancelled() {
                engine.tick(service.clone(), stop.clone()).await;
                tokio::select! {()=stop.cancelled()=>break,()=tokio::time::sleep(std::time::Duration::from_millis(600))=>()}
            }
        })
    }
    pub(super) async fn review(&self, run: &Run, cancel: CancellationToken) -> Result<(), Error> {
        let result = if let Some(deadline) = run.deadline {
            tokio::time::timeout(
                std::time::Duration::from_millis(deadline.saturating_sub(now()).max(1) as u64),
                self.explore(run, cancel.clone()),
            )
            .await
            .unwrap_or(Err(Error::Model("search_budget_exhausted")))
        } else {
            self.explore(run, cancel).await
        };
        match result {
            Ok(()) => self.store.reviewed(run.clone(), false).await,
            Err(Error::Model("search_budget_exhausted")) => {
                self.store.reviewed(run.clone(), true).await
            }
            Err(e) => Err(e),
        }
    }
    async fn explore(&self, run: &Run, cancel: CancellationToken) -> Result<(), Error> {
        if run.exploration.is_none() {
            return self.evaluate(run, cancel).await;
        }
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            match self.store.advance(run.clone()).await? {
                Next::Compare => self.evaluate(run, cancel.clone()).await?,
                Next::Discover(plan) => self.discover(run, plan, cancel.clone()).await?,
                Next::Complete => return Ok(()),
            }
        }
    }
    async fn evaluate(&self, run: &Run, cancel: CancellationToken) -> Result<(), Error> {
        let mut plan = self.store.plan(run.clone()).await?;
        if plan.candidates.is_empty() {
            return Ok(());
        }
        let config = run.config.ok_or(Error::NotReady)?;
        let keys = plan
            .candidates
            .iter()
            .map(|c| (c.id, protocol::key(&plan.context, c, config)))
            .collect();
        let missing = self.store.cached(run.clone(), keys).await?;
        plan.candidates.retain(|c| missing.contains(&c.id));
        if plan.candidates.is_empty() {
            return Ok(());
        }
        let (parallel, max_questions) = self
            .decisions
            .execution_limits(config)
            .await
            .map_err(|e| Error::Model(e.code()))?;
        let groups = protocol::groups(plan, config, max_questions)?;
        let parallel = parallel.clamp(1, 4);
        let mut calls=stream::iter(groups).map(|g|{
 let cancel=cancel.clone();async move{
 if cancel.is_cancelled(){return Err(Error::Cancelled)}
 let (output,request)=self.decisions.pinned(config,g.batch,cancel.clone()).await.map_err(|e|match e{crate::modules::model_execution::Error::Cancelled=>Error::Cancelled,other=>Error::Model(other.code())})?;
 let mut values=Vec::new();
 for (question,candidate,key) in g.keys {
 let answer=output.answers.get(&question).ok_or(Error::Model("invalid_model_response"))?;
 let relation=answer.choice.parse::<i64>().map_err(|_|Error::Model("invalid_model_response"))?;
 if !(0..=5).contains(&relation){return Err(Error::Model("invalid_model_response"))}
 values.push(Assessment{candidate,key,context_hash:g.context_hash.clone(),relation,statistics:serde_json::json!({"source":output.statistics,"probabilities":answer.probabilities,"confidence":answer.confidence,"model":output.model}),request_id:request.id});
 }
 self.store.commit(run.clone(),values).await
 }
 }).buffer_unordered(parallel);
        let mut failure = None;
        while let Some(result) = calls.next().await {
            if let Err(e) = result {
                failure.get_or_insert(e);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}
