#!/usr/bin/env bash
# Purpose: Build and embed the frontend after checking shared design output.
# Pattern: Product build and verification entry point.
# Usage: Invoked by the corresponding pnpm script.
# Related: scripts/generate-design-tokens.mjs, backend/Cargo.toml.
set -euo pipefail
PUPUTYX_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PUPUTYX_ROOT"
pnpm tokens:check
node scripts/prepare-document-runtime.mjs
pnpm --filter @puputyx/frontend build
cargo build --workspace --release --locked --features embedded-ui
