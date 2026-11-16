#!/usr/bin/env bash
set -euo pipefail
PUPUTYX_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PUPUTYX_ROOT"
if [[ "${1:-}" != "--no-build" ]]; then
  ./scripts/build.sh
fi
python3 scripts/smoke_test.py "$PUPUTYX_ROOT/target/release/PuPuTyX"
