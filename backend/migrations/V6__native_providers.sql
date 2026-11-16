-- Purpose: Extend provider protocols while preserving config IDs, ciphertext and request lineage.
-- Pattern: Rebuild the cyclic registry with deferred foreign keys in refinery's transaction.
-- Usage: Forward-only migration; existing lm_studio keeps its compatibility protocol.
-- Related: V5__model_registry.sql, adapters/llm/, tests/provider_migration.rs.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE llm_provider_connections_v6 (
 id TEXT PRIMARY KEY NOT NULL,current_config_version_id TEXT,
 FOREIGN KEY(id,current_config_version_id) REFERENCES llm_provider_config_versions_v6(connection_id,id)
) STRICT;
CREATE TABLE llm_provider_config_versions_v6 (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES llm_provider_connections_v6(id),
 version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible','openai','claude','gemini','lm_studio_native','llama_cpp','sglang','vllm','litellm')),
 base_url TEXT NOT NULL,model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 180),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),encrypted_secret TEXT,created_at INTEGER NOT NULL,
 UNIQUE(connection_id,id),UNIQUE(connection_id,version)
) STRICT;
CREATE TABLE llm_requests_v6 (
 id TEXT PRIMARY KEY NOT NULL,provider_config_version_id TEXT NOT NULL REFERENCES llm_provider_config_versions_v6(id),
 kind TEXT NOT NULL CHECK(kind IN ('text','structured')),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 elapsed_ms INTEGER,prompt_tokens INTEGER,completion_tokens INTEGER,error_code TEXT,created_at INTEGER NOT NULL
) STRICT;
INSERT INTO llm_provider_connections_v6 SELECT * FROM llm_provider_connections;
INSERT INTO llm_provider_config_versions_v6 SELECT * FROM llm_provider_config_versions;
INSERT INTO llm_requests_v6 SELECT * FROM llm_requests;
DROP TABLE llm_requests;
DROP TABLE llm_provider_connections;
DROP TABLE llm_provider_config_versions;
ALTER TABLE llm_provider_connections_v6 RENAME TO llm_provider_connections;
ALTER TABLE llm_provider_config_versions_v6 RENAME TO llm_provider_config_versions;
ALTER TABLE llm_requests_v6 RENAME TO llm_requests;
CREATE INDEX llm_requests_recent ON llm_requests(provider_config_version_id,created_at DESC);
PRAGMA user_version=6;
