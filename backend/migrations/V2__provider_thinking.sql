-- Purpose: Pin optional thinking settings to immutable provider configuration revisions.
-- Pattern: Existing revisions use provider defaults. Short-lived draft diagnostics contain no credentials.
-- Usage: Admin probes a draft before committing the exact tested settings.
-- Related: model_registry, sqlite/providers.rs, http/provider_drafts.rs.
CREATE TABLE provider_thinking (
 config_id TEXT PRIMARY KEY REFERENCES llm_provider_config_versions(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 effort TEXT CHECK(effort IS NULL OR (enabled=1 AND effort IN ('low','medium','high','xhigh')))
) STRICT;
CREATE TABLE provider_diagnostics (
 token TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL,
 draft_hash TEXT NOT NULL,
 effective_effort TEXT,
 expires_at INTEGER NOT NULL
) STRICT;
PRAGMA user_version=2;
