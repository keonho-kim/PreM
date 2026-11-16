// Purpose: Verify admission fairness, resizing and reservation cleanup under cancellation races.
// Pattern: Poll queued futures deterministically; only the bounded timeout test uses wall time.
// Usage: cargo test admission_tests; production has no test-only policy paths.
// Related: admission.rs, capacity.rs.
use super::{admission::Admission, *};
use std::{
    future::{Future, poll_fn},
    pin::Pin,
    task::Poll,
};
fn policy(id: Uuid, version: i64, parallel: u32, queue: u32) -> Capacity {
    Capacity {
        connection_id: id,
        version,
        limits: Limits {
            max_parallel: parallel,
            queue_capacity: queue,
            queue_timeout_seconds: 1,
        },
    }
}
async fn pending<T>(future: &mut Pin<Box<impl Future<Output = T>>>) {
    poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
}
#[tokio::test]
async fn fifo_full_queue_and_connections_are_independent() {
    let a = Admission::default();
    let id = Uuid::new_v4();
    let other = Uuid::new_v4();
    let p = policy(id, 1, 1, 2);
    a.apply(p);
    a.apply(policy(other, 1, 1, 0));
    let stop = CancellationToken::new();
    let cancel = CancellationToken::new();
    let first = a.enter(id, &stop, &cancel).await.unwrap();
    let mut second = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut second).await;
    let mut third = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut third).await;
    assert!(matches!(
        a.enter(id, &stop, &cancel).await,
        Err(Error::Busy)
    ));
    let independent = a.enter(other, &stop, &cancel).await.unwrap();
    drop(independent);
    drop(first);
    let second = second.await.unwrap();
    assert_eq!(a.apply(p).queued, 1);
    pending(&mut third).await;
    drop(second);
    let third = third.await.unwrap();
    drop(third);
    assert_eq!(a.apply(p).active, 0);
}
#[tokio::test]
async fn shrinking_keeps_accepted_work_and_increasing_wakes_waiters() {
    let a = Admission::default();
    let id = Uuid::new_v4();
    let old = policy(id, 1, 2, 2);
    a.apply(old);
    let stop = CancellationToken::new();
    let cancel = CancellationToken::new();
    let first = a.enter(id, &stop, &cancel).await.unwrap();
    let second = a.enter(id, &stop, &cancel).await.unwrap();
    let mut third = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut third).await;
    let mut fourth = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut fourth).await;
    let small = policy(id, 2, 1, 0);
    let counts = a.apply(small);
    assert_eq!((counts.active, counts.queued), (2, 2));
    assert_eq!(
        a.apply(old).settings.version,
        2,
        "stale reads cannot restore an old limit"
    );
    assert!(matches!(
        a.enter(id, &stop, &cancel).await,
        Err(Error::Busy)
    ));
    drop(first);
    assert_eq!(a.apply(small).queued, 2);
    drop(second);
    let third = third.await.unwrap();
    assert_eq!(a.apply(small).queued, 1);
    a.apply(policy(id, 3, 2, 2));
    let fourth = fourth.await.unwrap();
    assert_eq!(a.apply(small).active, 2);
    drop(third);
    drop(fourth);
    assert_eq!(a.apply(small).active, 0);
}
#[tokio::test]
async fn dropped_waiter_and_granted_but_unpolled_reservation_release_capacity() {
    let a = Admission::default();
    let id = Uuid::new_v4();
    let p = policy(id, 1, 1, 1);
    a.apply(p);
    let stop = CancellationToken::new();
    let cancel = CancellationToken::new();
    let first = a.enter(id, &stop, &cancel).await.unwrap();
    let mut waiting = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut waiting).await;
    drop(waiting);
    assert_eq!(a.apply(p).queued, 0);
    let mut waiting = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut waiting).await;
    drop(first);
    assert_eq!(a.apply(p).active, 1);
    drop(waiting);
    assert_eq!(a.apply(p).active, 0);
}
#[tokio::test]
async fn cancellation_shutdown_and_wait_timeout_do_not_leak_slots() {
    let a = Admission::default();
    let id = Uuid::new_v4();
    let p = policy(id, 1, 1, 1);
    a.apply(p);
    let stop = CancellationToken::new();
    let cancel = CancellationToken::new();
    let first = a.enter(id, &stop, &cancel).await.unwrap();
    let mut waiting = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut waiting).await;
    cancel.cancel();
    assert!(matches!(waiting.await, Err(Error::Cancelled)));
    assert_eq!(a.apply(p).queued, 0);
    let cancel = CancellationToken::new();
    assert!(matches!(
        a.enter(id, &stop, &cancel).await,
        Err(Error::QueueTimeout)
    ));
    assert_eq!(a.apply(p).queued, 0);
    let mut waiting = Box::pin(a.enter(id, &stop, &cancel));
    pending(&mut waiting).await;
    stop.cancel();
    assert!(matches!(waiting.await, Err(Error::Cancelled)));
    drop(first);
    assert_eq!(a.apply(p).active, 0);
}
