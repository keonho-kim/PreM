#!/usr/bin/env bash
set -euo pipefail
PREM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PREM_ROOT"
if [[ "${1:-}" != "--no-build" ]]; then
  ./scripts/build.sh
fi
python3 scripts/smoke_test.py "$PREM_ROOT/target/release/PreM"
