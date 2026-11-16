// Purpose: Own the async-sqlite client and bounded application admission.
// Pattern: The library owns the SQLite worker; one connection serializes short transactions.
// Usage: app holds storage ownership until close completes; adapters receive a narrow queue.
// Related: migrations.rs, projects.rs, async-sqlite 0.7, modules/libraries/ports.rs.
mod collection;
mod documents;
mod guides;
mod libraries;
mod migrations;
mod model_capacity;
mod model_requests;
mod outlines;
mod ppt_imports;
mod presentations;
mod projects;
mod providers;
mod relations;
mod search;
mod source_snapshot;
mod studio;
mod templates;
use crate::{
    adapters::filesystem::Storage,
    modules::{libraries::LibraryStore, projects::ProjectStore},
};
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::Semaphore;
pub(super) struct Unavailable;
impl From<Unavailable> for crate::modules::projects::Error {
    fn from(_: Unavailable) -> Self {
        Self::Unavailable
    }
}
impl From<Unavailable> for crate::modules::libraries::Error {
    fn from(_: Unavailable) -> Self {
        Self::Unavailable
    }
}
struct Queue {
    client: async_sqlite::Client,
    slots: Arc<Semaphore>,
    closed: AtomicBool,
}
impl Queue {
    async fn call<T, E>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<T, E> + Send + 'static,
    ) -> Result<T, E>
    where
        T: Send + 'static,
        E: From<Unavailable> + Send + 'static,
    {
        if self.closed.load(Ordering::Acquire) {
            return Err(Unavailable.into());
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| E::from(Unavailable))?;
        self.client
            .conn_mut(move |db| {
                let _permit = permit;
                Ok(action(db))
            })
            .await
            .map_err(|error| {
                tracing::error!(%error,"SQLite worker request failed");
                E::from(Unavailable)
            })?
    }
}
pub(crate) struct Database {
    queue: Arc<Queue>,
    storage: Option<Storage>,
}
impl Database {
    pub fn open(root: &Path, storage: Storage) -> anyhow::Result<Self> {
        // Migration preflight and backup complete before the async client opens the database.
        let mut connection = migrations::open(root)?;
        if let Err(error) = collection::run(&mut connection, root) {
            tracing::warn!(%error,"Blob collection skipped; stored data retained");
        }
        drop(connection);
        let client = async_sqlite::ClientBuilder::new()
            .path(root.join("db/app.sqlite"))
            .queue_capacity(65)
            .open_blocking()?;
        client.conn_blocking(|db| {
            db.busy_timeout(Duration::from_secs(5))?;
            db.execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
            )
        })?;
        Ok(Self {
            queue: Arc::new(Queue {
                client,
                slots: Arc::new(Semaphore::new(64)),
                closed: AtomicBool::new(false),
            }),
            storage: Some(storage),
        })
    }
    pub fn recover_uploads(&self) -> anyhow::Result<()> {
        self.queue
            .client
            .conn_blocking(libraries::recover_interrupted)?;
        Ok(())
    }
    pub fn recover_requests(&self) -> anyhow::Result<()> {
        self.queue
            .client
            .conn_blocking(model_requests::recover_interrupted)?;
        Ok(())
    }
    pub fn ppt_imports(&self) -> Arc<dyn crate::modules::ppt_imports::Store> {
        Arc::new(ppt_imports::SqliteImports(self.queue.clone()))
    }
    pub fn guides(&self) -> Arc<dyn crate::modules::guides::Store> {
        Arc::new(guides::SqliteGuides(self.queue.clone()))
    }
    pub fn search(&self) -> Arc<dyn crate::modules::search::Store> {
        Arc::new(search::SqliteSearch(self.queue.clone()))
    }
    pub fn relations(&self) -> Arc<dyn crate::modules::relations::Store> {
        Arc::new(relations::SqliteRelations(self.queue.clone()))
    }
    pub fn recover_relations(&self) -> anyhow::Result<()> {
        self.queue.client.conn_blocking(relations::recover)?;
        Ok(())
    }
    pub fn presentations(&self) -> Arc<dyn crate::modules::presentations::Store> {
        Arc::new(presentations::SqlitePresentations(self.queue.clone()))
    }
    pub fn recover_presentations(&self) -> anyhow::Result<()> {
        self.queue.client.conn_blocking(presentations::recover)?;
        Ok(())
    }
    pub fn outlines(&self) -> Arc<dyn crate::modules::outlines::Store> {
        Arc::new(outlines::SqliteOutlines(self.queue.clone()))
    }
    pub fn recover_outlines(&self) -> anyhow::Result<()> {
        self.queue.client.conn_blocking(outlines::recover)?;
        Ok(())
    }
    pub fn studio(&self) -> Arc<dyn crate::modules::studio::Store> {
        Arc::new(studio::SqliteStudio(self.queue.clone()))
    }
    pub fn templates(&self) -> Arc<dyn crate::modules::templates::Store> {
        Arc::new(templates::SqliteTemplates(self.queue.clone()))
    }
    pub fn documents(&self) -> Arc<dyn crate::modules::documents::Store> {
        Arc::new(documents::SqliteDocuments(self.queue.clone()))
    }
    pub fn recover_documents(&self) -> anyhow::Result<()> {
        self.queue.client.conn_blocking(documents::recover)?;
        Ok(())
    }
    pub fn projects(&self) -> Arc<dyn ProjectStore> {
        Arc::new(projects::SqliteProjects(self.queue.clone()))
    }
    pub fn libraries(&self) -> Arc<dyn LibraryStore> {
        Arc::new(libraries::SqliteLibraries(self.queue.clone()))
    }
    pub fn providers(&self) -> Arc<dyn crate::modules::model_registry::ProviderStore> {
        Arc::new(providers::SqliteProviders(self.queue.clone()))
    }
    pub fn requests(&self) -> Arc<dyn crate::modules::model_execution::RequestStore> {
        Arc::new(model_requests::SqliteRequests(self.queue.clone()))
    }
    pub fn encrypted_configs(&self) -> anyhow::Result<Vec<(String, String)>> {
        Ok(self.queue.client.conn_blocking(|db| {
            db.prepare("SELECT id,encrypted_secret FROM llm_provider_config_versions WHERE encrypted_secret IS NOT NULL")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<Vec<_>,_>>()
        })?)
    }
    pub async fn shutdown(mut self) -> anyhow::Result<()> {
        self.queue.closed.store(true, Ordering::Release);
        self.queue.client.close().await?;
        self.storage.take();
        Ok(())
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        self.queue.closed.store(true, Ordering::Release);
        // Successful async shutdown already released storage; never enqueue a second close.
        if self.storage.is_some() {
            let _ = self.queue.client.close_blocking();
            self.storage.take();
        }
    }
}
