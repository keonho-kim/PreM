#!/usr/bin/env bash
# Purpose: Reject Linux bundles that depend on libraries installed only on the build runner.
# Pattern: Read-only Ubuntu base, disabled networking and bundled Python for the verification harness.
# Usage: bash scripts/verify-release-linux.sh release/PreM-vYYYYMMDD-linux-arch.tar.gz
# Related: verify-release.py, package-release.py, .github/workflows/release.yml.
set -euo pipefail
PREM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PREM_ROOT"
PREM_ARCHIVE="${1:?Pass a release archive relative to the repository root}"
PREM_BUNDLE="${PREM_ARCHIVE%.tar.gz}"
PREM_PYTHON="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["python"])' "$PREM_BUNDLE/runtime/document-manifest.json")"
# This image contains only the OS baseline; no apt/npm/pip installation is allowed here.
docker run --rm --network none --read-only \
  --tmpfs /qa/tests/.artifacts:rw,exec,size=3g \
  --tmpfs /tmp:rw,exec,size=256m \
  --env "LD_LIBRARY_PATH=/qa/$PREM_BUNDLE/runtime/lib" \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --volume "$PREM_ROOT:/qa:ro" \
  ubuntu:24.04@sha256:73b999393d07f2bf65a40373778a44dc9a6d54ad7718d29247d8ff9413c4d6a8 \
  "/qa/$PREM_BUNDLE/runtime/$PREM_PYTHON" \
  /qa/scripts/verify-release.py "/qa/$PREM_ARCHIVE"
