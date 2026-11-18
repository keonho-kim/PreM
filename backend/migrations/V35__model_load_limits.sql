-- Purpose: Pin optional LM Studio model load limits with immutable connection revisions.
-- Pattern: Nullable fields preserve routing for all existing connections.
-- Usage: Applied on startup before the registry opens.
-- Related: model_registry/mod.rs, adapters/model_http/lm_load.rs.
ALTER TABLE llm_provider_config_versions ADD COLUMN context_length INTEGER CHECK(context_length BETWEEN 1 AND 2147483647);
ALTER TABLE llm_provider_config_versions ADD COLUMN physical_batch_size INTEGER CHECK(physical_batch_size BETWEEN 1 AND 2147483647);
PRAGMA user_version=35;
