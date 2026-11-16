// Purpose: Start the single PuPuTyX application runtime.
// Pattern: Thin binary entry point delegating resource ownership to app.
// Usage: PuPuTyX --data-storage-path <absolute-path>.
// Related: app/mod.rs, app/config.rs.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    puputyx_backend::app::run().await
}
