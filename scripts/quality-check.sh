#!/usr/bin/env bash
# Purpose: Run the native CI gate plus the installed developer-tool and dependency policy checks.
# Pattern: Common behavioral gate lives in check-core.sh; local CLI policy stays explicit.
# Usage: pnpm check after setup and runtime:install.
# Related: check-core.sh, rust-tools.mjs, package.json.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
pnpm tools:check
pnpm check:core
pnpm check:deps
