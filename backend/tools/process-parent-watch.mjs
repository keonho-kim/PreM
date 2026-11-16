// Purpose: Terminate an orphaned document engine after its owning server disappears.
// Pattern: A non-blocking worker thread checks only the known parent PID.
// Usage: Started by document-extract.mjs; never consumes document instructions.
// Related: document-extract.mjs, adapters/processes/mod.rs.
import { workerData } from 'node:worker_threads';
setInterval(() => {
  try {
    process.kill(workerData.parent, 0);
  } catch (error) {
    if (error.code === 'ESRCH') process.kill(process.pid, 'SIGKILL');
  }
}, 2000);
