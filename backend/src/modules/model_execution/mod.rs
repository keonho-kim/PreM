// Purpose: Own bounded model calls and sanitized history for generation and decisions.
// Pattern: Shared admission and cancellation around one pinned configuration.
// Usage: Inference and Decision services supply protocol calls and validation.
// Related: types.rs, modules/inference/, modules/decisions/, adapters/sqlite/model_requests.rs.
mod admission;
#[cfg(test)]
mod admission_tests;
mod capacity;
mod types;
use crate::modules::model_registry::{Credentials, DiscoveryInput, Registry};
pub(crate) use capacity::{Capacity, CapacityStatus, Limits};
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;
pub(crate) use types::{Error, RequestRecord};
use uuid::Uuid;
pub(crate) type CallFuture<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait RequestStore: Send + Sync {
    fn capacity(&self, id: Uuid) -> CallFuture<Capacity>;
    fn save_capacity(&self, id: Uuid, expected: i64, limits: Limits) -> CallFuture<Capacity>;
    fn start(&self, record: RequestRecord) -> CallFuture<()>;
    fn finish(&self, record: RequestRecord) -> CallFuture<()>;
    fn list(&self, provider: Uuid) -> CallFuture<Vec<RequestRecord>>;
}
pub(crate) struct Outcome<T> {
    pub value: T,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}
#[derive(Clone)]
pub(crate) struct Execution {
    registry: Registry,
    store: Arc<dyn RequestStore>,
    admission: admission::Admission,
    stop: CancellationToken,
    discovery_slots: Arc<tokio::sync::Semaphore>,
}
impl Execution {
    pub fn new(registry: Registry, store: Arc<dyn RequestStore>) -> Self {
        Self {
            registry,
            store,
            admission: admission::Admission::default(),
            stop: CancellationToken::new(),
            discovery_slots: Arc::new(tokio::sync::Semaphore::new(4)),
        }
    }
    pub fn cancel(&self) {
        self.stop.cancel();
    }
    pub async fn capacity(&self, id: Uuid) -> Result<CapacityStatus, Error> {
        let settings = self.store.capacity(id).await?;
        Ok(self.admission.apply(settings))
    }
    pub async fn save_capacity(
        &self,
        id: Uuid,
        expected: i64,
        limits: Limits,
    ) -> Result<CapacityStatus, Error> {
        if expected < 0 {
            return Err(crate::modules::model_registry::Error::Invalid(
                "저장 기준을 확인한 뒤 다시 시도하세요.",
            )
            .into());
        }
        let settings = self
            .store
            .save_capacity(id, expected, limits.validate()?)
            .await?;
        Ok(self.admission.apply(settings))
    }
    async fn admit(
        &self,
        id: Uuid,
        cancel: &CancellationToken,
    ) -> Result<admission::Reservation, Error> {
        self.capacity(id).await?;
        self.admission.enter(id, &self.stop, cancel).await
    }
    pub async fn history(&self, id: Uuid) -> Result<Vec<RequestRecord>, Error> {
        self.store.list(id).await
    }
    pub async fn query<T>(
        &self,
        id: Uuid,
        version: i64,
        call: impl FnOnce(Credentials) -> CallFuture<T> + Send,
    ) -> Result<T, Error> {
        let c = self.registry.credentials(id, version).await?;
        authenticate(&c)?;
        let _permit = self
            .admit(c.connection_id, &CancellationToken::new())
            .await?;
        self.run(c.timeout_seconds, call(c)).await
    }
    pub async fn discover<T>(
        &self,
        input: DiscoveryInput,
        call: impl FnOnce(Credentials) -> CallFuture<T> + Send,
    ) -> Result<T, Error> {
        self.draft_query(input, None, call).await
    }
    pub async fn draft_query<T>(
        &self,
        input: DiscoveryInput,
        settings: Option<&crate::modules::model_registry::Settings>,
        call: impl FnOnce(Credentials) -> CallFuture<T> + Send,
    ) -> Result<T, Error> {
        // Unsaved endpoints have no connection capacity row: bound discovery globally.
        let _slot = self
            .discovery_slots
            .try_acquire()
            .map_err(|_| Error::Busy)?;
        let mut c = self.registry.discovery_credentials(input).await?;
        if let Some(s) = settings {
            c.model_identifier.clone_from(&s.model_identifier);
            c.timeout_seconds = s.timeout_seconds;
            c.max_output_tokens = s.max_output_tokens;
            c.thinking = s.thinking;
            c.context_length = s.context_length;
            c.physical_batch_size = s.physical_batch_size;
        }
        authenticate(&c)?;
        let _permit = if c.connection_id.is_nil() {
            None
        } else {
            Some(
                self.admit(c.connection_id, &CancellationToken::new())
                    .await?,
            )
        };
        self.run(c.timeout_seconds, call(c)).await
    }
    pub async fn execute<T>(
        &self,
        id: Uuid,
        version: i64,
        kind: &str,
        call: impl FnOnce(Credentials) -> CallFuture<Outcome<T>> + Send,
    ) -> Result<(T, RequestRecord), Error> {
        let c = self.registry.credentials(id, version).await?;
        self.with_credentials(c, kind, call, CancellationToken::new())
            .await
    }
    pub async fn pinned_execution_limits(
        &self,
        config: Uuid,
    ) -> Result<(usize, crate::modules::model_registry::ProviderKind), Error> {
        let credentials = self.registry.pinned_credentials(config).await?;
        Ok((
            self.capacity(credentials.connection_id)
                .await?
                .settings
                .limits
                .max_parallel as usize,
            credentials.kind,
        ))
    }
    pub async fn pinned<T>(
        &self,
        config: Uuid,
        kind: &str,
        cancel: CancellationToken,
        call: impl FnOnce(Credentials) -> CallFuture<Outcome<T>> + Send,
    ) -> Result<(T, RequestRecord), Error> {
        let c = self.registry.pinned_credentials(config).await?;
        self.with_credentials(c, kind, call, cancel).await
    }
    async fn with_credentials<T>(
        &self,
        c: Credentials,
        kind: &str,
        call: impl FnOnce(Credentials) -> CallFuture<Outcome<T>> + Send,
        cancel: CancellationToken,
    ) -> Result<(T, RequestRecord), Error> {
        let _permit = self.admit(c.connection_id, &cancel).await?;
        let mut record = RequestRecord {
            id: Uuid::new_v4(),
            config_id: c.config_id,
            kind: kind.into(),
            status: "running".into(),
            elapsed_ms: None,
            prompt_tokens: None,
            completion_tokens: None,
            error_code: None,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
        };
        self.store.start(record.clone()).await?;
        let started = Instant::now();
        let result = match authenticate(&c) {
            Err(e) => Err(e),
            Ok(()) => {
                let future = self.run(c.timeout_seconds, call(c));
                tokio::select! {biased; ()=cancel.cancelled()=>Err(Error::Cancelled),r=future=>r}
            }
        };
        record.elapsed_ms = Some(started.elapsed().as_millis() as i64);
        match &result {
            Ok(r) => {
                record.status = "succeeded".into();
                record.prompt_tokens = r.input_tokens;
                record.completion_tokens = r.output_tokens;
            }
            Err(e) => {
                record.status = "failed".into();
                record.error_code = Some(e.code().into());
            }
        }
        self.store.finish(record.clone()).await?;
        Ok((result?.value, record))
    }
    async fn run<T>(&self, seconds: u32, future: CallFuture<T>) -> Result<T, Error> {
        tokio::select! { biased;
            () = self.stop.cancelled() => Err(Error::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(seconds.into()), future) => result.map_err(|_| Error::Timeout)?,
        }
    }
}
fn authenticate(c: &Credentials) -> Result<(), Error> {
    if c.kind.descriptor().key && c.token.is_none() {
        Err(Error::Authentication)
    } else {
        Ok(())
    }
}
