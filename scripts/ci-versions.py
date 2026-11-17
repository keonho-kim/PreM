#!/usr/bin/env python3
# Purpose: Expose canonical version files to CI before selecting Node and uv.
# Pattern: Read-only GitHub step outputs; no duplicated workflow version literals.
# Usage: python3 scripts/ci-versions.py >> "$GITHUB_OUTPUT"
# Related: runtime-versions.json, .node-version, rust-toolchain.toml, package.json.
import json
from pathlib import Path
import re
root = Path(__file__).resolve().parent.parent
runtime = json.loads((root/'scripts/runtime-versions.json').read_text())
package = json.loads((root/'package.json').read_text())
values = {**runtime, 'node': (root/'.node-version').read_text().strip(),
          'pnpm': package['packageManager'].split('@')[1],
          'rust': re.search(r'channel\s*=\s*"([^"]+)"', (root/'rust-toolchain.toml').read_text())[1]}
for key, value in values.items():
    if not re.fullmatch(r'[a-zA-Z0-9.\-]+', value):
        raise ValueError('Unsafe version output')
    print(f'{key}={value}')
