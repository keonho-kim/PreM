// Purpose: Parse process-start configuration for the single application instance.
// Pattern: Absolute storage path and typed network arguments at the boundary.
// Usage: Called by app::run before acquiring storage or binding HTTP.
// Related: app/mod.rs, adapters/filesystem/storage.rs.
use clap::Parser;
use std::{net::IpAddr, path::PathBuf};
#[derive(Debug, Parser)]
#[command(name = "PreM", version, about = "PreM application server")]
pub(super) struct Config {
    #[arg(long, value_parser = absolute_path)]
    pub data_storage_path: PathBuf,
    #[arg(long, env = "APP_LISTEN_ADDRESS", default_value = "0.0.0.0")]
    pub listen_address: IpAddr,
    #[arg(long, env = "APP_PORT", default_value_t = 8000)]
    pub port: u16,
    #[arg(long, env = "APP_LOG_LEVEL", default_value = "info")]
    pub log_level: String,
    #[arg(long, env = "APP_SECRET_KEY_FILE", value_parser = absolute_path)]
    pub secret_key_file: Option<PathBuf>,
}
fn absolute_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("--data-storage-path requires an absolute path".to_owned());
    }
    Ok(path)
}
