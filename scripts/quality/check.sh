#!/usr/bin/env bash
# Purpose: Check source, runtime, dependencies and integration behavior during development.
# Pattern: Pinned project dependencies; no development CLI installation during verification.
# Usage: pnpm check:core after runtime:install for development quality verification.
# Related: rust-tools.mjs, tests/helpers/.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/../.."
js_audit() {
  pnpm audit
  npm audit --prefix runtime/kordoc --omit=dev
}
rust_policy() {
  node scripts/quality/rust-tools.mjs policy
}

mode=${1:-core}
case "$mode" in
  full) pnpm tools:check ;;
  core) ;;
  deps) rust_policy; js_audit; exit 0 ;;
  *) echo "Usage: bash scripts/quality/check.sh [core|full|deps]" >&2; exit 2 ;;
esac

pnpm check:versions
python3 scripts/quality/doc-links.py
pnpm tokens:check
node scripts/runtime/documents.mjs prepare
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
js_audit
if [[ "$mode" == full ]]; then
  rust_policy
fi
