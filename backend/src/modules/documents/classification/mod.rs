// Purpose: Classify canonical document blocks using pinned model settings and saved batches.
// Pattern: Completed decisions are reused; waiting configuration releases execution without failure.
// Usage: Common document classify node; templates never enter this module.
// Related: execution.rs, decisions/, adapters/sqlite/documents/results.rs.
use super::*;
use crate::modules::decisions::{Batch, Question};
use std::collections::BTreeMap;
use tokio_util::sync::CancellationToken;
impl Documents {
    pub(super) async fn classify_job(
        &self,
        mut job: Job,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        if self
            .store
            .blocks(job.id, None, true, String::new(), 0)
            .await?
            .is_empty()
        {
            return self.align_pages(&job, &cancel).await;
        }
        job = self.store.pin(job).await?;
        if job.status == "waiting_configuration" {
            return Err(Error::WaitingConfiguration);
        }
        let config = job.config_id.ok_or(Error::Storage)?;
        let detail = self
            .store
            .detail(job.kind.clone(), job.item_id, Some(job.id))
            .await?;
        if matches!(detail.page_mode.as_deref(), Some("layout" | "slide")) {
            pages::classify(self, &job, config, &detail.pages, &cancel).await?;
            return self.align_pages(&job, &cancel).await;
        }
        let (_, batch_size) = self.decisions.execution_limits(config).await?;
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let blocks = self
                .store
                .blocks(job.id, None, true, String::new(), 0)
                .await?;
            if blocks.is_empty() {
                return self.align_pages(&job, &cancel).await;
            }
            let (batch, selected) = batch(
                blocks
                    .into_iter()
                    .take(if batch_size == 1 { 1 } else { 16 })
                    .collect(),
            )?;
            let (evaluation, record) = self.decisions.pinned(config, batch, cancel.clone()).await?;
            let mut commit = Vec::new();
            for (key, id) in selected {
                let answer = evaluation
                    .answers
                    .get(&key)
                    .ok_or(Error::Processing("invalid_model_response"))?;
                let value = match answer.choice.as_str() {
                    "0" => 0,
                    "1" => 1,
                    _ => return Err(Error::Processing("invalid_model_response")),
                };
                commit.push(DecisionCommit{block_id:id,value,statistics:serde_json::json!({"source":evaluation.statistics,"probabilities":answer.probabilities,"confidence":answer.confidence,"model":evaluation.model}),request_id:record.id});
            }
            self.store.decisions(job.clone(), commit).await?;
        }
    }
}
mod request;
use request::batch;

mod pages;
