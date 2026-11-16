// Purpose: Drive leased extraction and batched decisions with persisted checkpoints.
// Pattern: Apalis custom backend reads SQLite; cancellation/heartbeat fence every result commit.
// Usage: Application starts workers after recovery and joins them before closing storage.
// Related: mod.rs, ports.rs, adapters/sqlite/documents/.
use super::*;
use crate::modules::{
    decisions::{Batch, Question},
    model_execution,
};
use apalis_core::{backend::custom::BackendBuilder, task::Task, worker::builder::WorkerBuilder};
use futures_util::{StreamExt, sink, stream};
use std::{collections::BTreeMap, time::Duration};
use tokio_util::sync::CancellationToken;
impl Documents {
    pub fn start(&self, stop: CancellationToken) -> tokio::task::JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            let mut workers = tokio::task::JoinSet::new();
            for i in 0..2 {
                let service = this.clone();
                let token = stop.clone();
                workers.spawn_blocking(move || {
 let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().expect("worker runtime");
 runtime.block_on(async move {
     let source=(service.clone(),token.clone());
     let backend=BackendBuilder::new().database(source).fetcher(|source,_,_|{
      stream::unfold(source.clone(),|(service,stop)|async move{
       loop {
        if stop.is_cancelled(){return None}
        if let Err(e)=service.store.scan_uploads(service.extractor.profile()).await {tracing::warn!(%e,"document queue scan failed");}
        match service.store.claim().await {
         Ok(Some(job))=>return Some((Ok::<_,std::io::Error>(Some(Task::new(job))),(service,stop))),
         Err(e)=>tracing::warn!(%e,"document claim failed"),_=>(),
        }
        tokio::select!{()=stop.cancelled()=>return None,()=tokio::time::sleep(Duration::from_millis(800))=>{}}
       }
      }).boxed()
     }).sink(|_,_|sink::unfold((),|_,_:Task<Job>|futures_util::future::ready(Err::<(),std::io::Error>(std::io::Error::other("read-only document source"))))).build().expect("complete backend builder");
     let shutdown=token.clone();
     let worker=WorkerBuilder::new(format!("document-{i}")).backend(backend).build(move |job:Job|{let service=service.clone();let token=token.clone();async move{service.run_job(job,token).await;Ok::<(),std::io::Error>(())}});
     if let Err(e)=worker.run_until(async move {shutdown.cancelled().await;Ok::<(),std::io::Error>(())}).await{tracing::error!(%e,"document worker stopped");}
    });
    });
            }
            while let Some(r) = workers.join_next().await {
                if let Err(e) = r {
                    tracing::error!(%e,"document worker join failed");
                }
            }
        })
    }
    fn run_job(
        self,
        job: Job,
        stop: CancellationToken,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async move {
            let cancel = stop.child_token();
            let monitor_cancel = cancel.clone();
            let store = self.store.clone();
            let watched = job.clone();
            let monitor = tokio::spawn(async move {
                loop {
                    tokio::select! {()=monitor_cancel.cancelled()=>break,()=tokio::time::sleep(Duration::from_secs(2))=>{
                     let Some(lease)=watched.lease.clone() else{monitor_cancel.cancel();break};
                     if !matches!(store.heartbeat(watched.id,lease).await,Ok(true)){monitor_cancel.cancel();break}
                    }}
                }
            });
            let result = self.process(job.clone(), cancel.clone()).await;
            cancel.cancel();
            let _ = monitor.await;
            match result {
                Ok(()) => (),
                Err(Error::Cancelled) => {
                    let _ = self
                        .store
                        .finish(job, "queued".into(), Some("interrupted".into()), true)
                        .await;
                }
                Err(Error::Processing(code)) => {
                    let retry = [
                        "provider_busy",
                        "provider_queue_timeout",
                        "provider_timeout",
                        "provider_unreachable",
                        "storage_unavailable",
                    ]
                    .contains(&code);
                    let _ = self
                        .store
                        .finish(job, "failed".into(), Some(code.into()), retry)
                        .await;
                }
                Err(e) => {
                    tracing::warn!(job_id=%job.id,%e,"document processing failed");
                    let _ = self
                        .store
                        .finish(
                            job,
                            "failed".into(),
                            Some("processing_failed".into()),
                            false,
                        )
                        .await;
                }
            }
        })
    }
    async fn process(&self, mut job: Job, cancel: CancellationToken) -> Result<(), Error> {
        if job.kind == "templates" {
            if self
                .detail(job.kind.clone(), job.item_id, Some(job.id))
                .await?
                .template
                .is_some()
            {
                self.store
                    .finish(job, "succeeded".into(), None, false)
                    .await?;
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
                    crate::modules::templates::Error::MissingRuntime => {
                        Error::Processing("template_runtime_missing")
                    }
                    _ => Error::Processing("template_extract_failed"),
                })?;
            self.store
                .finish(job, "succeeded".into(), None, false)
                .await?;
            return Ok(());
        }
        if job.extraction_id.is_none() {
            job.extraction_id = self.store.restore_extraction(job.clone()).await?;
            if job.extraction_id.is_none() {
                let result = self.extractor.extract(job.clone(), cancel.clone()).await?;
                job.extraction_id = Some(self.store.extraction(job.clone(), result).await?);
            }
        }
        if self
            .store
            .blocks(job.id, None, true, String::new(), 0)
            .await?
            .is_empty()
        {
            self.store
                .finish(job, "succeeded".into(), None, false)
                .await?;
            return Ok(());
        }
        job = self.store.pin(job).await?;
        if job.status == "waiting_configuration" {
            return Ok(());
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
                self.store
                    .finish(job, "succeeded".into(), None, false)
                    .await?;
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
