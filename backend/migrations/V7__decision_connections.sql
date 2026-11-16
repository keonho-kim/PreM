-- Purpose: Extend versioned connections and request history for independent decisions.
-- Pattern: Rebuild constrained tables atomically while preserving existing IDs and ciphertext.
-- Usage: Embedded refinery migration; never edit after deployment.
-- Related: V6__native_providers.sql, modules/decisions/.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE llm_provider_connections_v7 (
 id TEXT PRIMARY KEY NOT NULL,current_config_version_id TEXT,
 FOREIGN KEY(id,current_config_version_id) REFERENCES llm_provider_config_versions_v7(connection_id,id)
) STRICT;
CREATE TABLE llm_provider_config_versions_v7 (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES llm_provider_connections_v7(id),
 version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible','openai','claude','gemini','lm_studio_native','llama_cpp','sglang','vllm','litellm','typesafe','lm_studio_decision','llama_decision','sglang_decision','vllm_decision','litellm_decision','openai_decision','gemini_decision')),
 base_url TEXT NOT NULL,model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 180),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),encrypted_secret TEXT,created_at INTEGER NOT NULL,
 UNIQUE(connection_id,id),UNIQUE(connection_id,version)
) STRICT;
CREATE TABLE llm_requests_v7 (
 id TEXT PRIMARY KEY NOT NULL,provider_config_version_id TEXT NOT NULL REFERENCES llm_provider_config_versions_v7(id),
 kind TEXT NOT NULL CHECK(kind IN ('text','structured','decision')),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 elapsed_ms INTEGER,prompt_tokens INTEGER,completion_tokens INTEGER,error_code TEXT,created_at INTEGER NOT NULL
) STRICT;
INSERT INTO llm_provider_connections_v7 SELECT * FROM llm_provider_connections;
INSERT INTO llm_provider_config_versions_v7 SELECT * FROM llm_provider_config_versions;
INSERT INTO llm_requests_v7 SELECT * FROM llm_requests;
DROP TABLE llm_requests;
DROP TABLE llm_provider_connections;
DROP TABLE llm_provider_config_versions;
ALTER TABLE llm_provider_connections_v7 RENAME TO llm_provider_connections;
ALTER TABLE llm_provider_config_versions_v7 RENAME TO llm_provider_config_versions;
ALTER TABLE llm_requests_v7 RENAME TO llm_requests;
CREATE INDEX llm_requests_recent ON llm_requests(provider_config_version_id,created_at DESC);
PRAGMA user_version=7;
