// Purpose: Classify canonical document blocks using pinned model settings and saved batches.
// Pattern: Completed decisions are reused; waiting configuration releases execution without failure.
// Usage: Common document classify node; templates never enter this module.
// Related: execution.rs, decisions/, adapters/sqlite/documents/results.rs.
use super::*;
use crate::modules::{
    decisions::{Batch, Question},
    model_execution,
};
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
            return Ok(());
        }
        job = self.store.pin(job).await?;
        if job.status == "waiting_configuration" {
            return Err(Error::WaitingConfiguration);
        }
        let config = job.config_id.ok_or(Error::Storage)?;
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let blocks = self
                .store
                .blocks(job.id, None, true, String::new(), 0)
                .await?;
            if blocks.is_empty() {
                return Ok(());
            }
            let (batch, selected) = batch(blocks)?;
            let outcome = self.decisions.pinned(config, batch, cancel.clone()).await;
            let (evaluation, record) = outcome.map_err(|e| match e {
                model_execution::Error::Cancelled => Error::Cancelled,
                other => Error::Processing(other.code()),
            })?;
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
fn batch(blocks: Vec<Block>) -> Result<(Batch, Vec<(String, Uuid)>), Error> {
    let mut batch = Batch {
        state: serde_json::json!({"regions":{}}),
        questions: BTreeMap::new(),
    };
    let mut selected = Vec::new();
    for block in blocks.into_iter().take(16) {
        let key = format!("r{}", selected.len());
        let mut candidate = batch.clone();
        candidate.state["regions"][&key] = serde_json::json!({"text":block.text,"kind":block.kind});
        candidate.questions.insert(key.clone(),Question::Choice{instructions:format!("state.regions.{key}가 원본 문서의 목차 영역인지 판정하세요. 문서 구성과 순서를 안내하는 제목 목록은 목차입니다. 일반 본문 또는 개별 절 제목만으로는 목차가 아닙니다."),criteria:BTreeMap::from([("0".into(),"일반 본문, 표, 또는 개별 제목".into()),("1".into(),"문서 구성과 순서를 안내하는 목차 영역".into())])});
        if serde_json::to_vec(&candidate)
            .map_err(|_| Error::Storage)?
            .len()
            > 28 * 1024
        {
            break;
        }
        batch = candidate;
        selected.push((key, block.id));
    }
    if selected.is_empty() {
        return Err(Error::Processing("decision_input_limit"));
    }
    Ok((batch, selected))
}
