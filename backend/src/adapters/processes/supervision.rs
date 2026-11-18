// Purpose: Apply separate wall-clock budgets to document extraction and auxiliary tools.
// Pattern: Each child has one deadline and cancellation path; raw tool output stays private.
// Usage: Document adapters name each extraction or rendering step for server diagnostics.
// Related: documents.rs, reference_pptx.rs, pptx.rs, mod.rs.
use crate::modules::documents::Error;
use std::{
    process::{ExitStatus, Stdio},
    time::{Duration, Instant},
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

const DOCUMENT_LIMIT: Duration = Duration::from_secs(30 * 60);
const AUXILIARY_LIMIT: Duration = Duration::from_secs(3 * 60);

pub(super) async fn document_status(
    step: &'static str,
    cmd: Command,
    cancel: CancellationToken,
) -> Result<ExitStatus, Error> {
    let start = Instant::now();
    tracing::info!(
        step,
        limit_secs = DOCUMENT_LIMIT.as_secs(),
        "document tool started"
    );
    let result = wait_for_child(cmd, cancel, DOCUMENT_LIMIT, "document_step_timeout").await;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    match &result {
        Ok(status) => tracing::info!(step, elapsed_ms, %status, "document tool finished"),
        Err(error) => tracing::warn!(step, elapsed_ms, %error, "document tool stopped"),
    }
    result
}
pub(super) async fn run_document(
    step: &'static str,
    cmd: Command,
    cancel: CancellationToken,
) -> Result<(), Error> {
    check_status(document_status(step, cmd, cancel).await?)
}
pub(super) async fn run_auxiliary(cmd: Command, cancel: CancellationToken) -> Result<(), Error> {
    check_status(wait_for_child(cmd, cancel, AUXILIARY_LIMIT, "extraction_timeout").await?)
}
fn check_status(status: ExitStatus) -> Result<(), Error> {
    if status.success() {
        Ok(())
    } else {
        Err(Error::Processing("extract_failed"))
    }
}
async fn wait_for_child(
    mut cmd: Command,
    cancel: CancellationToken,
    limit: Duration,
    timeout_error: &'static str,
) -> Result<ExitStatus, Error> {
    let mut child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| Error::Processing("runtime_missing"))?;
    let outcome = tokio::select! {
        () = cancel.cancelled() => Err(Error::Cancelled),
        result = tokio::time::timeout(limit, child.wait()) => match result {
            Ok(status) => status.map_err(|_| Error::Processing("extract_failed")),
            Err(_) => Err(Error::Processing(timeout_error)),
        }
    };
    if outcome.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn timeout_and_cancellation_remain_distinct() {
        fn sleeper() -> Command {
            let mut cmd = Command::new("sleep");
            cmd.arg("60");
            cmd
        }
        assert_eq!(DOCUMENT_LIMIT.as_secs(), 1800);
        assert_eq!(AUXILIARY_LIMIT.as_secs(), 180);
        let result = wait_for_child(
            sleeper(),
            CancellationToken::new(),
            Duration::from_millis(10),
            "document_step_timeout",
        )
        .await;
        assert!(matches!(
            result,
            Err(Error::Processing("document_step_timeout"))
        ));
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            document_status("test", sleeper(), token).await,
            Err(Error::Cancelled)
        ));
    }
}
