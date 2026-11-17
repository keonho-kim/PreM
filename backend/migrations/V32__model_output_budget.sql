-- Purpose: Pin optional generation output budgets with immutable provider configurations.
-- Pattern: Preserve configuration identities/ciphertext while adding a budget and longer timeout bounds.
-- Usage: Embedded refinery migration, applied before application startup.
-- Related: model_registry/, inference/execution.rs, providers.rs.
CREATE TABLE llm_provider_config_versions_next (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible','openai','claude','gemini','lm_studio_native','llama_cpp','sglang','vllm','litellm','typesafe','lm_studio_decision','llama_decision','sglang_decision','vllm_decision','vllm_sr_decision','litellm_decision','openai_decision','gemini_decision')),
 base_url TEXT NOT NULL,model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 900),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),encrypted_secret TEXT,created_at INTEGER NOT NULL,
 max_output_tokens INTEGER CHECK(max_output_tokens IS NULL OR max_output_tokens BETWEEN 256 AND 65536),
 UNIQUE(connection_id,id),UNIQUE(connection_id,version)
) STRICT;
INSERT INTO llm_provider_config_versions_next
 SELECT id,connection_id,version,name,provider_type,base_url,model_identifier,timeout_seconds,enabled,encrypted_secret,created_at,NULL
 FROM llm_provider_config_versions;
DROP TABLE llm_provider_config_versions;
ALTER TABLE llm_provider_config_versions_next RENAME TO llm_provider_config_versions;
CREATE TEMP TABLE migration_fk_guard(errors INTEGER CHECK(errors=0));
INSERT INTO migration_fk_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_guard;
PRAGMA user_version=32;
