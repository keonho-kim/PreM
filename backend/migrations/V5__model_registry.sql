-- Purpose: Persist versioned provider settings and sanitized connection test outcomes.
-- Pattern: Immutable config versions, conditional pointers and request lineage.
-- Usage: Embedded refinery migration; never edit after deployment.
-- Related: modules/model_registry/, modules/inference/, adapters/sqlite/providers.rs.
CREATE TABLE llm_provider_connections (
 id TEXT PRIMARY KEY NOT NULL, current_config_version_id TEXT,
 FOREIGN KEY(id,current_config_version_id) REFERENCES llm_provider_config_versions(connection_id,id)
) STRICT;
CREATE TABLE llm_provider_config_versions (
 id TEXT PRIMARY KEY NOT NULL, connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0), name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible')),
 base_url TEXT NOT NULL, model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 180),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), encrypted_secret TEXT,
 created_at INTEGER NOT NULL, UNIQUE(connection_id,id), UNIQUE(connection_id,version)
) STRICT;
CREATE TABLE llm_requests (
 id TEXT PRIMARY KEY NOT NULL, provider_config_version_id TEXT NOT NULL REFERENCES llm_provider_config_versions(id),
 kind TEXT NOT NULL CHECK(kind IN ('text','structured')),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 elapsed_ms INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER,
 error_code TEXT, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX llm_requests_recent ON llm_requests(provider_config_version_id,created_at DESC);
PRAGMA user_version=5;
