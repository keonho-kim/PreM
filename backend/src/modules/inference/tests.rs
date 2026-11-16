// Purpose: Verify general inference lifecycle independently of the diagnostic prompt.
// Pattern: Consumer-owned in-memory ports exercise arbitrary output, validation and cancellation.
// Usage: Cargo unit tests; HTTP provider contracts remain in integration tests.
// Related: execution.rs, diagnostics.rs, ports.rs.
use super::*;
use crate::modules::model_execution::RequestStore;
use crate::modules::model_registry::{
    self, Credentials, Provider, ProviderKind, ProviderStore, Registry, SecretCodec, Settings,
    StoreFuture,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;
struct RegistryStore(Provider);
impl ProviderStore for RegistryStore {
    fn list(&self) -> StoreFuture<Vec<Provider>> {
        let p = self.0.clone();
        Box::pin(async move { Ok(vec![p]) })
    }
    fn get(&self, _: Uuid) -> StoreFuture<Provider> {
        let p = self.0.clone();
        Box::pin(async move { Ok(p) })
    }
    fn config(&self, _: Uuid) -> StoreFuture<Provider> {
        let p = self.0.clone();
        Box::pin(async move { Ok(p) })
    }
    fn save(&self, p: Provider, _: i64) -> StoreFuture<Provider> {
        Box::pin(async move { Ok(p) })
    }
}
struct NoSecrets;
impl SecretCodec for NoSecrets {
    fn encrypt(&self, _: Uuid, _: &str) -> Result<String, model_registry::Error> {
        Err(model_registry::Error::Secret)
    }
    fn decrypt(&self, _: Uuid, _: &str) -> Result<secrecy::SecretString, model_registry::Error> {
        Err(model_registry::Error::Secret)
    }
}
#[derive(Default)]
struct Records(Mutex<Vec<RequestRecord>>);
impl RequestStore for Records {
    fn capacity(
        &self,
        id: Uuid,
    ) -> crate::modules::model_execution::CallFuture<crate::modules::model_execution::Capacity>
    {
        Box::pin(async move {
            Ok(crate::modules::model_execution::Capacity {
                connection_id: id,
                version: 0,
                limits: Default::default(),
            })
        })
    }
    fn save_capacity(
        &self,
        _: Uuid,
        _: i64,
        _: crate::modules::model_execution::Limits,
    ) -> crate::modules::model_execution::CallFuture<crate::modules::model_execution::Capacity>
    {
        Box::pin(async { Err(Error::Storage) })
    }

    fn start(&self, r: RequestRecord) -> CallFuture<()> {
        self.0.lock().unwrap().push(r);
        Box::pin(async { Ok(()) })
    }
    fn finish(&self, r: RequestRecord) -> CallFuture<()> {
        self.0.lock().unwrap().push(r);
        Box::pin(async { Ok(()) })
    }
    fn list(&self, _: Uuid) -> CallFuture<Vec<RequestRecord>> {
        let records = self.0.lock().unwrap().clone();
        Box::pin(async move { Ok(records) })
    }
}
struct Model {
    answer: String,
    calls: Arc<AtomicUsize>,
}
impl ModelClient for Model {
    fn models(&self, _: Credentials) -> CallFuture<Vec<String>> {
        Box::pin(async { Ok(vec![]) })
    }
    fn complete(&self, c: Credentials, i: CompletionInput) -> CallFuture<Completion> {
        let text = self.answer.clone();
        let calls = self.calls.clone();
        Box::pin(async move {
            calls.fetch_add(1, Ordering::Relaxed);
            assert_eq!(c.model_identifier, "fixture");
            assert_eq!(i.prompt, "Summarize the supplied content");
            Ok(Completion {
                text,
                prompt_tokens: Some(4),
                completion_tokens: Some(3),
            })
        })
    }
}
fn setup(answer: &str) -> (Inference, Arc<Records>, Arc<AtomicUsize>, Uuid) {
    let id = Uuid::new_v4();
    let p = Provider {
        id,
        config_id: Uuid::new_v4(),
        version: 1,
        settings: Settings {
            name: "Fixture".into(),
            provider_type: ProviderKind::OpenaiCompatible,
            base_url: "http://localhost/".into(),
            model_identifier: "fixture".into(),
            timeout_seconds: 5,
            enabled: true,
        },
        encrypted_secret: None,
        created_at: 0,
    };
    let records = Arc::new(Records::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = Registry::new(Arc::new(RegistryStore(p)), Arc::new(NoSecrets));
    (
        Inference::new(
            crate::modules::model_execution::Execution::new(registry, records.clone()),
            Arc::new(Model {
                answer: answer.into(),
                calls: calls.clone(),
            }),
        ),
        records,
        calls,
        id,
    )
}
fn input() -> CompletionInput {
    CompletionInput {
        system: "A caller-owned task".into(),
        prompt: "Summarize the supplied content".into(),
        schema: None,
        max_tokens: 64,
    }
}
#[tokio::test]
async fn general_execution_accepts_non_diagnostic_content_and_records_the_outcome() {
    let (service, records, calls, id) = setup("A document summary");
    let result = service.execute(id, 1, input(), |_| Ok(())).await.unwrap();
    assert_eq!(result.text, "A document summary");
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    let rows = records.0.lock().unwrap();
    assert_eq!(rows[0].status, "running");
    assert_eq!(rows[1].status, "succeeded");
    assert_eq!(rows[0].id, rows[1].id);
}
#[tokio::test]
async fn schema_rejection_is_finalized_as_failure_before_scenario_validation() {
    let (service, records, _, id) = setup("{\"valid\":false}");
    let mut request = input();
    request.schema = Some(
        serde_json::json!({"type":"object","properties":{"valid":{"const":true}},"required":["valid"]}),
    );
    let result = service
        .execute(id, 1, request, |_| {
            panic!("invalid schema must not reach scenario validation")
        })
        .await;
    assert!(matches!(result, Err(Error::InvalidResponse)));
    let rows = records.0.lock().unwrap();
    assert_eq!(rows[1].status, "failed");
    assert_eq!(
        rows[1].error_code.as_deref(),
        Some("invalid_model_response")
    );
}
#[tokio::test]
async fn shutdown_cancellation_rejects_before_admission_without_calling_the_provider() {
    let (service, records, calls, id) = setup("Unused");
    service.cancel();
    assert!(matches!(
        service.execute(id, 1, input(), |_| Ok(())).await,
        Err(Error::Cancelled)
    ));
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    assert!(records.0.lock().unwrap().is_empty());
}
