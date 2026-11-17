#!/usr/bin/env python3
# Purpose: Reject stale local documentation links and section anchors.
# Pattern: Repository markdown only; external websites and code examples are not fetched.
# Usage: python3 scripts/check-doc-links.py from any directory.
# Related: dev-docs/README.md, blueprint/README.md, check-core.sh.
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import unquote
ROOT = Path(__file__).resolve().parent.parent
files = [ROOT/name for name in ['README.md','design.md','AGENTS.md','tests/README.md','runtime/README.md']]
files += sorted((ROOT/'dev-docs').glob('*.md')) + sorted((ROOT/'blueprint').glob('*.md'))
def prose(path):
    return re.sub(r'^```.*?^```[^\n]*', '', path.read_text(), flags=re.M|re.S)
def anchors(path):
    seen = {}; result = set()
    for match in re.finditer(r'^#{1,6}\s+(.+)', prose(path), re.M):
        title = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', match[1]).strip().lower()
        title = ''.join(c for c in title if c in '_-' or c.isspace() or unicodedata.category(c)[0] in 'LNM')
        title = re.sub(r'\s', '-', title)
        number = seen.get(title, 0); seen[title] = number + 1
        result.add(title + (f'-{number}' if number else ''))
    return result
errors = []
for source in files:
    for match in re.finditer(r'\[[^]\n]+\]\(([^)\s]+)\)', prose(source)):
        link = unquote(match[1].strip('<>'))
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',link): continue
        path, _, fragment = link.partition('#')
        target = (source.parent/path).resolve() if path else source
        if not target.exists(): errors.append(f'{source.relative_to(ROOT)}: missing {link}')
        elif fragment and target.is_file() and target.suffix=='.md' and fragment not in anchors(target):
            errors.append(f'{source.relative_to(ROOT)}: missing anchor {link}')
if errors:
    print('\n'.join(sorted(set(errors))))
    sys.exit(1)
print(f'Local links and anchors verified in {len(files)} documents.')
