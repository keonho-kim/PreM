-- Purpose: Persist bounded dynamic search workspaces without duplicating canonical source text.
-- Pattern: Additive versioned execution state; legacy runs retain their original single-pass behavior.
-- Usage: Relations owns all new tables and pins source reads before model calls.
-- Related: modules/relations/exploration.rs, adapters/sqlite/relations/exploration.rs.
ALTER TABLE relation_settings ADD COLUMN planner_connection_id TEXT REFERENCES llm_provider_connections(id);
ALTER TABLE relation_candidates ADD COLUMN workspace_round INTEGER NOT NULL DEFAULT 0 CHECK(workspace_round BETWEEN 0 AND 2);
ALTER TABLE relation_assessments ADD COLUMN context_version INTEGER NOT NULL DEFAULT 1 CHECK(context_version IN(1,2));
CREATE TABLE relation_workspaces (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES relation_runs(id),
 definition_version INTEGER NOT NULL DEFAULT 2 CHECK(definition_version=2),
 round INTEGER NOT NULL DEFAULT 0 CHECK(round BETWEEN 0 AND 2),
 phase TEXT NOT NULL DEFAULT 'compare' CHECK(phase IN('compare','context','discover','complete')),
 planner_config_id TEXT REFERENCES llm_provider_config_versions(id),
 deadline_at INTEGER,
 stop_reason TEXT CHECK(stop_reason IN('reviewed','needs_review','no_new_results','budget')),
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE relation_reads (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 round INTEGER NOT NULL CHECK(round BETWEEN 0 AND 2),
 position INTEGER NOT NULL,
 block_id TEXT NOT NULL REFERENCES content_blocks(id),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 1800),
 PRIMARY KEY(candidate_id,round,position), UNIQUE(candidate_id,round,block_id)
) STRICT;
CREATE TABLE relation_review_history (
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 round INTEGER NOT NULL,
 assessment_key TEXT NOT NULL REFERENCES relation_assessments(cache_key),
 PRIMARY KEY(candidate_id,round)
) STRICT;
CREATE TABLE relation_workspace_peers (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 position INTEGER NOT NULL,
 candidate_id TEXT NOT NULL REFERENCES relation_candidates(id),
 block_id TEXT NOT NULL REFERENCES content_blocks(id),
 relation INTEGER NOT NULL CHECK(relation IN(2,4)),
 PRIMARY KEY(run_id,position)
) STRICT;
CREATE TABLE relation_pulls (
 run_id TEXT NOT NULL REFERENCES relation_runs(id),
 ordinal INTEGER NOT NULL,
 query TEXT NOT NULL,
 request_id TEXT REFERENCES llm_requests(id),
 added INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,ordinal), UNIQUE(run_id,query)
) STRICT;
CREATE INDEX relation_reads_block ON relation_reads(block_id);
PRAGMA user_version=18;
