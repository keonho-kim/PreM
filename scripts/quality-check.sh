#!/usr/bin/env bash
# Purpose: Run design source, formatting, frontend and Rust quality checks.
# Pattern: Product build and verification entry point.
# Usage: Invoked by the corresponding pnpm script.
# Related: package.json, scripts/generate-design-tokens.mjs.
set -euo pipefail
PREM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PREM_ROOT"
pnpm tools:check
pnpm tokens:check
node scripts/prepare-document-runtime.mjs
runtime/node/bin/node --test tests/helpers/kordoc-image-filter.mjs tests/helpers/parsing-checks.test.mjs tests/helpers/document-structure.test.mjs tests/helpers/presentation-quality.test.mjs
pnpm format:check
pnpm lint
pnpm --filter @prem/frontend knip
pnpm test:rust
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
pnpm --filter @prem/frontend test
pnpm check:deps
