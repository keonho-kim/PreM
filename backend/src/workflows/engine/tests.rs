// Purpose: Verify bounded admission, cancellation propagation and checkpoint skipping in the engine.
// Pattern: In-memory driver implements only the real consumer boundary, with deterministic signals.
// Usage: cargo nextest run --lib workflows::engine::tests.
// Related: engine/mod.rs, presentations/execution.rs.
use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
#[derive(Clone, Default)]
struct Fake {
    panic: Arc<AtomicBool>,
    claimed: Arc<AtomicUsize>,
    started: Arc<tokio::sync::Notify>,
    done: Arc<Mutex<Vec<&'static str>>>,
    failed: Arc<AtomicUsize>,
}
impl Driver for Fake {
    type Job = ();
    type Error = String;
    fn definition(&self, _job: &Self::Job) -> Definition {
        crate::workflows::definitions::PRESENTATION
    }
    fn claim(&self) -> Work<Option<()>, String> {
        self.claimed.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(Some(())) })
    }
    fn heartbeat(&self, _: ()) -> Work<bool, String> {
        Box::pin(async { Ok(true) })
    }
    fn begin(&self, _: (), n: Node) -> Work<bool, String> {
        let done = self.done.lock().unwrap().contains(&n.key);
        Box::pin(async move { Ok(!done) })
    }
    fn execute(&self, _: (), n: Node, stop: CancellationToken) -> Work<(), String> {
        let this = self.clone();
        Box::pin(async move {
            if this.panic.load(Ordering::SeqCst) {
                panic!("synthetic handler panic")
            };
            this.started.notify_one();
            if n.key == "render" {
                stop.cancelled().await;
                return Err("cancelled".into());
            }
            Ok(())
        })
    }
    fn finish(&self, _: (), n: Node) -> Work<(), String> {
        self.done.lock().unwrap().push(n.key);
        Box::pin(async { Ok(()) })
    }
    fn fail(&self, _: (), _: Option<String>) -> Work<(), String> {
        self.failed.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}
#[tokio::test]
async fn bounded_claims_and_cancelled_handler_leave_finished_nodes_reusable() {
    let engine = Engine::new(std::num::NonZeroUsize::new(1).unwrap());
    let fake = Fake::default();
    fake.done.lock().unwrap().push("write");
    let stop = CancellationToken::new();
    let task = tokio::spawn({
        let (engine, fake, stop) = (engine.clone(), fake.clone(), stop.clone());
        async move { engine.tick(fake, stop).await }
    });
    tokio::time::timeout(Duration::from_secs(1), fake.started.notified())
        .await
        .unwrap();
    engine.tick(fake.clone(), CancellationToken::new()).await;
    assert_eq!(fake.claimed.load(Ordering::SeqCst), 1);
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(*fake.done.lock().unwrap(), ["write"]);
    assert_eq!(fake.failed.load(Ordering::SeqCst), 1);
    engine.tick(fake.clone(), stop).await;
    assert_eq!(fake.claimed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn handler_panic_is_joined_and_does_not_leave_heartbeat_running() {
    let engine = Engine::new(std::num::NonZeroUsize::new(1).unwrap());
    let fake = Fake::default();
    fake.panic.store(true, Ordering::SeqCst);
    tokio::time::timeout(
        Duration::from_secs(1),
        engine.tick(fake.clone(), CancellationToken::new()),
    )
    .await
    .unwrap();
    assert_eq!(fake.failed.load(Ordering::SeqCst), 1);
    assert!(fake.done.lock().unwrap().is_empty());
}
