-- Purpose: Persist editable per-connection request capacity without rewriting model revisions.
-- Pattern: Independent CAS settings; transient queue membership is owned by model execution.
-- Usage: Embedded refinery migration; existing connections receive defaults lazily on first save.
-- Related: modules/model_execution/capacity.rs, adapters/sqlite/model_capacity.rs.
CREATE TABLE model_request_capacity (
 connection_id TEXT PRIMARY KEY NOT NULL REFERENCES llm_provider_connections(id),
 version INTEGER NOT NULL CHECK(version>0),
 max_parallel INTEGER NOT NULL CHECK(max_parallel BETWEEN 1 AND 1024),
 queue_capacity INTEGER NOT NULL CHECK(queue_capacity BETWEEN 0 AND 4096),
 queue_timeout_seconds INTEGER NOT NULL CHECK(queue_timeout_seconds BETWEEN 1 AND 600)
) STRICT;
PRAGMA user_version=10;
