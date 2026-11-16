// Purpose: Bound active and queued requests per connection while supporting live limit changes.
// Pattern: Short mutex-protected FIFO admission; owned reservations release on cancel/drop/completion.
// Usage: Execution admits pinned calls; this is not the durable document-job queue.
// Related: capacity.rs, admission_tests.rs, modules/documents/worker.rs.
use super::{Capacity, CapacityStatus, Error};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
#[derive(Default, Clone)]
pub(super) struct Admission(Arc<Mutex<HashMap<Uuid, Gate>>>);
struct Gate {
    settings: Capacity,
    next: u64,
    active: HashSet<u64>,
    waiting: VecDeque<(u64, oneshot::Sender<()>)>,
}
impl Gate {
    fn pump(&mut self) {
        while self.active.len() < self.settings.limits.max_parallel as usize {
            let Some((id, sender)) = self.waiting.pop_front() else {
                break;
            };
            if sender.is_closed() {
                continue;
            }
            self.active.insert(id);
            if sender.send(()).is_err() {
                self.active.remove(&id);
            }
        }
    }
}
pub(super) struct Reservation {
    owner: Admission,
    connection: Uuid,
    id: u64,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        let mut state = self.owner.0.lock().expect("admission lock");
        if let Some(gate) = state.get_mut(&self.connection) {
            gate.active.remove(&self.id);
            gate.waiting.retain(|(id, _)| *id != self.id);
            gate.pump();
        }
    }
}
impl Admission {
    pub fn apply(&self, settings: Capacity) -> CapacityStatus {
        let mut state = self.0.lock().expect("admission lock");
        let gate = state.entry(settings.connection_id).or_insert_with(|| Gate {
            settings,
            next: 0,
            active: HashSet::new(),
            waiting: VecDeque::new(),
        });
        if settings.version > gate.settings.version {
            gate.settings = settings;
        }
        gate.pump();
        CapacityStatus {
            settings: gate.settings,
            active: gate.active.len(),
            queued: gate.waiting.len(),
        }
    }
    pub async fn enter(
        &self,
        connection: Uuid,
        stop: &CancellationToken,
        cancel: &CancellationToken,
    ) -> Result<Reservation, Error> {
        if stop.is_cancelled() || cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let (reservation, receiver, seconds) = {
            let mut state = self.0.lock().expect("admission lock");
            let gate = state.get_mut(&connection).ok_or(Error::Storage)?;
            gate.pump();
            let ready = gate.waiting.is_empty()
                && gate.active.len() < gate.settings.limits.max_parallel as usize;
            if !ready && gate.waiting.len() >= gate.settings.limits.queue_capacity as usize {
                return Err(Error::Busy);
            }
            gate.next = gate.next.checked_add(1).ok_or(Error::Storage)?;
            let id = gate.next;
            let reservation = Reservation {
                owner: self.clone(),
                connection,
                id,
            };
            let receiver = if ready {
                gate.active.insert(id);
                None
            } else {
                let (send, receive) = oneshot::channel();
                gate.waiting.push_back((id, send));
                Some(receive)
            };
            (
                reservation,
                receiver,
                gate.settings.limits.queue_timeout_seconds,
            )
        };
        if let Some(receiver) = receiver {
            tokio::select! { biased;
                () = stop.cancelled() => return Err(Error::Cancelled),
                () = cancel.cancelled() => return Err(Error::Cancelled),
                result = tokio::time::timeout(Duration::from_secs(seconds.into()), receiver) => {
                    result.map_err(|_| Error::QueueTimeout)?.map_err(|_| Error::Cancelled)?;
                }
            }
        }
        if stop.is_cancelled() || cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        Ok(reservation)
    }
}
