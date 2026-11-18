// Purpose: Own app-internal batched decision use cases independently of LLM generation.
// Pattern: Consumer-owned evaluator port plus shared model execution mechanics.
// Usage: Admin evaluates explicit samples; document processing can call the same service later.
// Related: types.rs, validation.rs, adapters/decisions/, model_execution/.
mod types;
mod validation;
use crate::modules::{
    model_execution::{CallFuture, Error, Execution, Outcome, RequestRecord},
    model_registry::Credentials,
};
use std::sync::Arc;
pub(crate) use types::{Answer, Batch, Evaluation, Question};
use uuid::Uuid;
pub(crate) trait Evaluator: Send + Sync {
    fn evaluate(&self, credentials: Credentials, batch: Batch) -> CallFuture<Outcome<Evaluation>>;
    fn models(&self, credentials: Credentials) -> CallFuture<Vec<String>>;
}
#[derive(Clone)]
pub(crate) struct Decisions {
    execution: Execution,
    evaluator: Arc<dyn Evaluator>,
}
impl Decisions {
    pub fn new(execution: Execution, evaluator: Arc<dyn Evaluator>) -> Self {
        Self {
            execution,
            evaluator,
        }
    }
    pub async fn evaluate(
        &self,
        id: Uuid,
        version: i64,
        batch: Batch,
    ) -> Result<(Evaluation, RequestRecord), Error> {
        batch.validate()?;
        let evaluator = self.evaluator.clone();
        self.execution
            .execute(id, version, "decision", move |c| {
                Box::pin(async move {
                    let result = evaluator.evaluate(c, batch.clone()).await?;
                    batch.validate_result(&result.value)?;
                    Ok(result)
                })
            })
            .await
    }
    pub async fn execution_limits(&self, config: Uuid) -> Result<(usize, usize), Error> {
        let (parallel, kind) = self.execution.pinned_execution_limits(config).await?;
        // A native encoder should not repeatedly read unrelated candidates from shared state.
        Ok((parallel, if kind.is_system() { 1 } else { 8 }))
    }
    pub async fn pinned(
        &self,
        config: Uuid,
        batch: Batch,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<(Evaluation, RequestRecord), Error> {
        batch.validate()?;
        let evaluator = self.evaluator.clone();
        self.execution
            .pinned(config, "decision", cancel, move |c| {
                Box::pin(async move {
                    let result = evaluator.evaluate(c, batch.clone()).await?;
                    batch.validate_result(&result.value)?;
                    Ok(result)
                })
            })
            .await
    }
    pub async fn probe(
        &self,
        input: crate::modules::model_registry::DiscoveryInput,
        settings: &crate::modules::model_registry::Settings,
    ) -> Result<(), Error> {
        let batch = Batch {
            state: serde_json::json!("목차\n1. 개요\n2. 계획"),
            questions: [(
                "category".into(),
                Question::Choice {
                    instructions: "입력에 맞는 유형을 선택하세요.".into(),
                    criteria: [
                        ("0".into(), "일반 문장".into()),
                        ("1".into(), "문서 목차".into()),
                    ]
                    .into(),
                },
            )]
            .into(),
        };
        let result = self
            .execution
            .draft_query(input, Some(settings), |c| {
                self.evaluator.evaluate(c, batch.clone())
            })
            .await?;
        batch.validate_result(&result.value)?;
        Ok(())
    }
    pub async fn discover(
        &self,
        input: crate::modules::model_registry::DiscoveryInput,
    ) -> Result<Vec<String>, Error> {
        self.execution
            .discover(input, |c| self.evaluator.models(c))
            .await
    }
    pub async fn models(&self, id: Uuid, version: i64) -> Result<Vec<String>, Error> {
        self.execution
            .query(id, version, |c| self.evaluator.models(c))
            .await
    }
}
