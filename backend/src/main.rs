// Purpose: Start the single PreM application runtime.
// Pattern: Thin binary entry point delegating resource ownership to app.
// Usage: PreM --data-storage-path <absolute-path>.
// Related: app/mod.rs, app/config.rs.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    prem_backend::app::run().await
}
