#!/usr/bin/env bash
# Purpose: Restore project packages and pinned developer tools.
# Pattern: Explicit development setup, separate from runtime startup.
# Usage: ./scripts/setup.sh from a prepared Rust/Node development host.
# Related: scripts/rust-tools.mjs, scripts/dev-tools.json, package.json.
set -euo pipefail
PUPUTYX_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PUPUTYX_ROOT"
pnpm install --frozen-lockfile
cargo fetch --locked
pnpm tools:install
