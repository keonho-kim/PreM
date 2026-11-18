// Purpose: Compose persistent shared projects and own startup and shutdown resources.
// Pattern: One application instance and a minimal integration-test boundary.
// Usage: The binary calls run; tests open isolated Application instances.
// Related: config.rs, adapters/sqlite/mod.rs, adapters/http/mod.rs.
mod config;
pub(crate) mod outline_authoring;
use crate::{
    adapters::{
        filesystem::{Blobs, Secrets, Storage},
        http,
        sqlite::Database,
    },
    modules::{assets::AssetService, libraries::LibraryService, projects::ProjectService},
};
use anyhow::Context;
use axum::Router;
use clap::Parser;
use std::{path::Path, sync::Arc};
use tracing_subscriber::EnvFilter;

struct ProcessingStop(tokio_util::sync::CancellationToken);
impl Drop for ProcessingStop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
pub struct Application {
    document_engine: crate::workflows::engine::Engine,
    relation_engine: crate::workflows::engine::Engine,
    outline_engine: crate::workflows::engine::Engine,
    workflow_engine: crate::workflows::engine::Engine,
    admin_access: http::AdminAccess,
    processing_stop: ProcessingStop,
    database: Database,
    projects: ProjectService,
    space: http::SpaceApi,
    providers: http::ProviderApi,
    documents: crate::modules::documents::Documents,
    studio: crate::modules::studio::Studio,
    guides: crate::modules::guides::Guides,
    processing_worker: Option<tokio::task::JoinHandle<()>>,
    relations: crate::modules::relations::Relations,
    search: crate::modules::search::Search,
    relation_worker: Option<tokio::task::JoinHandle<()>>,
    outlines: crate::modules::outlines::Outlines,
    outline_worker: Option<tokio::task::JoinHandle<()>>,
    presentations: crate::modules::presentations::Presentations,
    presentation_worker: Option<tokio::task::JoinHandle<()>>,
}
impl Application {
    /// Process bootstrap/test access only; never return this value over HTTP.
    pub fn admin_token(&self) -> &str {
        self.admin_access.cli_token()
    }
    pub fn open(root: &Path) -> anyhow::Result<Self> {
        Self::open_with_key(root, None)
    }
    pub fn open_with_key(root: &Path, key: Option<&Path>) -> anyhow::Result<Self> {
        use crate::modules::model_registry::SecretCodec;
        let storage = Storage::initialize(root)?;
        let files = Blobs::open(root)?;
        let database = Database::open(root, storage)?;
        let encrypted = database.encrypted_configs()?;
        let secrets = Arc::new(Secrets::open(root, key, !encrypted.is_empty())?);
        for (id, value) in encrypted {
            secrets.decrypt(uuid::Uuid::parse_str(&id)?, &value)?;
        }
        database.recover_uploads()?;
        database.recover_requests()?;
        database.recover_documents()?;
        database.recover_relations()?;
        database.recover_outlines()?;
        database.recover_presentations()?;
        let registry = crate::modules::model_registry::Registry::new(database.providers(), secrets);
        let execution =
            crate::modules::model_execution::Execution::new(registry.clone(), database.requests());
        let client = Arc::new(crate::adapters::llm::ProviderClient::new()?);
        let inference =
            crate::modules::inference::Inference::new(execution.clone(), client.clone());
        let decisions = crate::modules::decisions::Decisions::new(
            execution.clone(),
            Arc::new(crate::adapters::decisions::DecisionAdapter::new(client)?),
        );
        let providers = http::ProviderApi {
            model_loader: http::ModelLoader::new()?,
            execution,
            registry,
            decisions: decisions.clone(),
            diagnostics: crate::modules::inference::Diagnostics::new(inference.clone()),
            inference,
        };
        let outlines = crate::modules::outlines::Outlines::new(
            database.outlines(),
            providers.inference.clone(),
        );
        let projects = ProjectService::new(database.projects());
        let assets = AssetService::new(Arc::new(files));
        let imports =
            crate::modules::ppt_imports::Imports::new(database.ppt_imports(), assets.clone());
        let runtime = Arc::new(crate::adapters::processes::Runtime::open(
            root,
            assets.clone(),
            imports.clone(),
        )?);
        let presentations = crate::modules::presentations::Presentations::new(
            database.presentations(),
            runtime.clone(),
            providers.inference.clone(),
            assets.clone(),
        );
        let templates = crate::modules::templates::Templates::new(
            runtime.clone(),
            database.templates(),
            imports,
        );
        let documents = crate::modules::documents::Documents::new(
            database.documents(),
            runtime,
            decisions.clone(),
            templates,
        );
        let processing_stop = ProcessingStop(tokio_util::sync::CancellationToken::new());
        let processing_worker = None;
        let space = http::SpaceApi::new(LibraryService::new(database.libraries()), assets.clone());
        let studio = crate::modules::studio::Studio::new(database.studio());
        let guides = crate::modules::guides::Guides::new(database.guides());
        let relations = crate::modules::relations::Relations::new(
            database.relations(),
            decisions,
            providers.inference.clone(),
        );
        let search = crate::modules::search::Search::new(database.search());
        Ok(Self {
            relation_engine: crate::workflows::engine::Engine::new(
                std::num::NonZeroUsize::new(1).unwrap(),
            ),
            outline_engine: crate::workflows::engine::Engine::new(
                std::num::NonZeroUsize::new(1).unwrap(),
            ),
            document_engine: crate::workflows::engine::Engine::new(
                std::num::NonZeroUsize::new(2).unwrap(),
            ),
            workflow_engine: crate::workflows::engine::Engine::new(
                std::num::NonZeroUsize::new(1).unwrap(),
            ),
            admin_access: http::AdminAccess::new()?,
            presentations,
            presentation_worker: None,
            outlines,
            outline_worker: None,
            search,
            relations,
            relation_worker: None,
            guides,
            studio,
            database,
            projects,
            space,
            providers,
            documents,
            processing_stop,
            processing_worker,
        })
    }
    pub fn start_processing(&mut self) {
        if self.presentation_worker.is_none() {
            self.presentation_worker = Some(
                self.presentations
                    .start(self.processing_stop.0.clone(), self.workflow_engine.clone()),
            );
        }
        if self.outline_worker.is_none() {
            self.outline_worker = Some(
                self.outlines
                    .start(self.processing_stop.0.clone(), self.outline_engine.clone()),
            );
        }
        if self.relation_worker.is_none() {
            self.relation_worker = Some(
                self.relations
                    .start(self.processing_stop.0.clone(), self.relation_engine.clone()),
            );
        }
        if self.processing_worker.is_none() {
            self.processing_worker = Some(
                self.documents
                    .start(self.processing_stop.0.clone(), self.document_engine.clone()),
            );
        }
    }
    pub fn router(&self) -> Router {
        http::router(
            self.projects.clone(),
            self.space.clone(),
            self.providers.clone(),
            self.documents.clone(),
            self.space.assets(),
            http::WorkspaceApi {
                admin_access: self.admin_access.clone(),
                presentations: self.presentations.clone(),
                search: self.search.clone(),
                outlines: self.outlines.clone(),
                studio: self.studio.clone(),
                guides: self.guides.clone(),
                relations: self.relations.clone(),
            },
        )
    }
    pub async fn shutdown(self) -> anyhow::Result<()> {
        self.processing_stop.0.cancel();
        if let Some(worker) = self.presentation_worker {
            worker.await?;
        }
        if let Some(worker) = self.outline_worker {
            worker.await?;
        }
        if let Some(worker) = self.processing_worker {
            worker.await?;
        }
        if let Some(worker) = self.relation_worker {
            worker.await?;
        }
        self.presentations.close_editors().await?;
        self.providers.inference.cancel();
        self.space.shutdown().await?;
        self.database.shutdown().await
    }
}

pub async fn run() -> anyhow::Result<()> {
    let config = config::Config::parse();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_new(&config.log_level).context("invalid APP_LOG_LEVEL")?)
        .init();
    let mut application =
        Application::open_with_key(&config.data_storage_path, config.secret_key_file.as_deref())?;
    application.start_processing();
    let listener = tokio::net::TcpListener::bind((config.listen_address, config.port))
        .await
        .context("could not bind the HTTP server")?;
    eprintln!("PreM Admin token: {}", application.admin_token());
    tracing::info!(address = %listener.local_addr()?, version = env!("CARGO_PKG_VERSION"), "PreM server started");
    let result = axum::serve(listener, application.router())
        .with_graceful_shutdown({
            let space = application.space.clone();
            let inference = application.providers.inference.clone();
            let processing_stop = application.processing_stop.0.clone();
            async move {
                shutdown_signal().await;
                processing_stop.cancel();
                space.cancel_uploads();
                inference.cancel();
            }
        })
        .await;
    application.shutdown().await?;
    result.context("HTTP server failed")
}
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "could not listen for Ctrl+C");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::error!(%error, "could not listen for SIGTERM"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { () = ctrl_c => {}, () = terminate => {} }
    tracing::info!("PreM server shutting down");
}
