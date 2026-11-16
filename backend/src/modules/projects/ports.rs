// Purpose: Define the persistence operations consumed by the projects feature.
// Pattern: Object-safe asynchronous port without database or transport types.
// Usage: Implemented by the SQLite project store and injected by app.
// Related: mod.rs, adapters/sqlite/projects.rs.
use super::{Change, CreateResult, Error, ListQuery, Project, ProjectList};
use std::{future::Future, pin::Pin};
use uuid::Uuid;
pub(crate) type StoreFuture<T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send>>;
pub(crate) trait ProjectStore: Send + Sync {
    fn list(&self, query: ListQuery) -> StoreFuture<ProjectList>;
    fn get(&self, id: Uuid) -> StoreFuture<Project>;
    fn create(&self, project: Project, key: Uuid) -> StoreFuture<CreateResult>;
    fn update(&self, id: Uuid, change: Change, version: i64, now: i64) -> StoreFuture<Project>;
}
