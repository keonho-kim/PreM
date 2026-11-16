-- Purpose: Allow dedicated vLLM-SR connections while preserving all configuration identities.
-- Pattern: Rebuild only the constrained parent table with startup FK enforcement suspended.
-- Usage: Embedded append-only migration; verify all references before committing.
-- Related: V7__decision_connections.sql, adapters/sqlite/migrations.rs.
CREATE TABLE llm_provider_config_versions_next (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,
 provider_type TEXT NOT NULL CHECK(provider_type IN ('lm_studio','openai_compatible','openai','claude','gemini','lm_studio_native','llama_cpp','sglang','vllm','litellm','typesafe','lm_studio_decision','llama_decision','sglang_decision','vllm_decision','vllm_sr_decision','litellm_decision','openai_decision','gemini_decision')),
 base_url TEXT NOT NULL,model_identifier TEXT NOT NULL,
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 5 AND 180),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),encrypted_secret TEXT,created_at INTEGER NOT NULL,
 UNIQUE(connection_id,id),UNIQUE(connection_id,version)
) STRICT;
INSERT INTO llm_provider_config_versions_next SELECT * FROM llm_provider_config_versions;
DROP TABLE llm_provider_config_versions;
ALTER TABLE llm_provider_config_versions_next RENAME TO llm_provider_config_versions;
CREATE TEMP TABLE migration_fk_guard(errors INTEGER CHECK(errors=0));
INSERT INTO migration_fk_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_guard;
PRAGMA user_version=15;
