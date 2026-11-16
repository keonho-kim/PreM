// Purpose: Define registry persistence and encryption needs without concrete adapters.
// Pattern: Consumer-owned asynchronous storage and synchronous small-secret operations.
// Usage: Implemented by SQLite and the filesystem-backed AEAD codec.
// Related: mod.rs, adapters/sqlite/providers.rs, adapters/filesystem/secrets.rs.
use super::{Error, Provider};
use secrecy::SecretString;
use std::{future::Future, pin::Pin};
use uuid::Uuid;
pub(crate) type StoreFuture<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait ProviderStore: Send + Sync {
    fn list(&self) -> StoreFuture<Vec<Provider>>;
    fn config(&self, id: Uuid) -> StoreFuture<Provider>;
    fn get(&self, id: Uuid) -> StoreFuture<Provider>;
    fn save(&self, provider: Provider, expected: i64) -> StoreFuture<Provider>;
}
pub(crate) trait SecretCodec: Send + Sync {
    fn encrypt(&self, id: Uuid, value: &str) -> Result<String, Error>;
    fn decrypt(&self, id: Uuid, value: &str) -> Result<SecretString, Error>;
}
