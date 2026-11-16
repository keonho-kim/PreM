#!/usr/bin/env python3
# Purpose: Verify existing application records and Blob bytes survive the presentation migration.
# Pattern: Read-only SQLite fingerprints, no row contents or credentials in reports.
# Usage: python3 tests/helpers/presentation-storage-audit.py before|after while the server is stopped.
# Related: V19 migration, tests/.artifacts/presentation-data-before.json.
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
root = Path(__file__).resolve().parents[2]
report = root / 'tests/.artifacts/presentation-data-before.json'
wal=root / 'data/db/app.sqlite-wal'
if wal.exists() and wal.stat().st_size:
    raise RuntimeError('Stop the server and allow WAL checkpointing before auditing')
db = sqlite3.connect(f'file:{root / "data/db/app.sqlite"}?mode=ro&immutable=1', uri=True)
def quote(name):
    return '"' + name.replace('"', '""') + '"'
def digest_rows(table, columns):
    rows = db.execute('SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(table)).fetchall()
    serialized = sorted(json.dumps(row, ensure_ascii=False, default=lambda value: value.hex()) for row in rows)
    return {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(serialized).encode()).hexdigest()}
def hash_file(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()
def blobs():
    return {str(p.relative_to(root / 'data')): hash_file(p)
            for p in (root / 'data/blobs').rglob('*') if p.is_file()}
if sys.argv[1] == 'before':
    tables = {}
    for (name,) in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='refinery_schema_history'"):
        columns = [r[1] for r in db.execute('PRAGMA table_info(' + quote(name) + ')')]
        tables[name] = {'columns': columns, **digest_rows(name, columns)}
    snapshot = {'version': db.execute('PRAGMA user_version').fetchone()[0], 'tables': tables, 'blobs': blobs(),
                'key_sha256': hashlib.sha256((root / 'data/config/secret.key').read_bytes()).hexdigest()}
    report.write_text(json.dumps(snapshot, indent=2))
    print(json.dumps({'version': snapshot['version'], 'tables': len(tables), 'blobs': len(snapshot['blobs'])}))
else:
    before = json.loads(report.read_text())
    changed = [name for name, old in before['tables'].items() if digest_rows(name, old['columns']) != {'rows': old['rows'], 'sha256': old['sha256']}]
    current = blobs()
    changed_blobs = [name for name, value in before['blobs'].items() if current.get(name) != value]
    key_ok = hashlib.sha256((root / 'data/config/secret.key').read_bytes()).hexdigest() == before['key_sha256']
    result = {'version': db.execute('PRAGMA user_version').fetchone()[0], 'changed_tables': changed, 'changed_blobs': changed_blobs,
              'key_preserved': key_ok, 'integrity': db.execute('PRAGMA integrity_check').fetchone()[0],
              'foreign_key_errors': len(db.execute('PRAGMA foreign_key_check').fetchall())}
    (root / 'tests/.artifacts/presentation-data-verification.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    assert not changed and not changed_blobs and key_ok and result['integrity'] == 'ok' and not result['foreign_key_errors']
