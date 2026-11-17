#!/usr/bin/env bash
# Purpose: Build and embed the frontend after checking shared design output.
# Pattern: Product build and verification entry point.
# Usage: Invoked by the corresponding pnpm script.
# Related: scripts/generate-design-tokens.mjs, backend/Cargo.toml.
set -euo pipefail
PREM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PREM_ROOT"
pnpm tokens:check
node scripts/prepare-document-runtime.mjs
pnpm --filter @prem/frontend build
cargo build --workspace --release --locked --features embedded-ui
