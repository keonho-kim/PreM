#!/usr/bin/env bash
# Purpose: Check source, runtime, dependencies and integration behavior during development.
# Pattern: Pinned project dependencies; no development CLI installation during verification.
# Usage: pnpm check:core after runtime:install for development quality verification.
# Related: quality-check.sh, tests/helpers/.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
pnpm check:versions
python3 scripts/check-doc-links.py
pnpm tokens:check
node scripts/prepare-document-runtime.mjs
runtime/node/bin/node --test tests/helpers/kordoc-image-filter.mjs tests/helpers/kordoc-runtime.test.mjs tests/helpers/parsing-checks.test.mjs tests/helpers/document-structure.test.mjs tests/helpers/presentation-quality.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 tests/helpers/storage-backup.test.py
pnpm format:check
pnpm check:structure
pnpm lint
pnpm --filter @prem/frontend knip
pnpm --filter @prem/frontend build
cargo test --workspace --all-features --locked -- --test-threads=2
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
pnpm --filter @prem/frontend test
pnpm audit
npm audit --prefix runtime/kordoc --omit=dev
