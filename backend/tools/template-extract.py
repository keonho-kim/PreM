#!/usr/bin/env python3
# Purpose: Run the pinned PPT Master template importer without document-content classification.
# Pattern: Local read-only PPTX intake, preserved native structure and a bounded reusable bundle.
# Usage: Python receives runtime root, original PPTX path and one owned output directory.
# Related: runtime/ppt-master/, modules/templates/, adapters/processes/templates.rs.
import hashlib
import json
import os
from pathlib import Path
import resource
import threading
import time
import runpy
import sys

runtime, source, output = map(Path, sys.argv[1:4])
owner = os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != owner:
            os._exit(1)
threading.Thread(target=watch_parent, daemon=True).start()
resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024,) * 2)
scripts = runtime / 'ppt-master/source/skills/ppt-master/scripts'
workspace = output / 'template'
sys.path.insert(0, str(scripts))
sys.argv = [str(scripts / 'pptx_template_import.py'), str(source), '--inheritance-mode', 'both', '--embed-images', '-o', str(workspace)]
try:
    try:
        runpy.run_path(str(scripts / 'pptx_template_import.py'), run_name='__main__')
    except SystemExit as error:
        if error.code not in (None, 0):
            raise RuntimeError('template_import_failed')
    manifest = json.loads((workspace / 'analysis/manifest.json').read_text())
    structure = json.loads((workspace / 'analysis/native_structure.json').read_text())
    original = workspace / 'sources/source.pptx'
    if original.read_bytes() != source.read_bytes():
        raise RuntimeError('source_changed')
    if not isinstance(manifest.get('slides'), list) or not manifest['slides']:
        raise RuntimeError('empty_template')
    # The original remains in the shared Blob Store. Rehydrate this conventional source path on use.
    manifest['source_blob_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    if isinstance(manifest.get('source'), dict):
        for key in list(manifest['source']):
            if 'path' in key.lower():
                manifest['source'][key] = 'sources/source.pptx'
    def normalize_paths(value):
        if isinstance(value, dict):
            return {k: normalize_paths(v) for k, v in value.items()}
        if isinstance(value, list):
            return [normalize_paths(v) for v in value]
        if isinstance(value, str) and value.startswith(str(workspace)):
            return str(Path(value).relative_to(workspace))
        if isinstance(value, str) and value == str(source):
            return 'sources/source.pptx'
        return value
    manifest = normalize_paths(manifest)
    structure = normalize_paths(structure)
    (workspace / 'analysis/native_structure.json').write_text(json.dumps(structure, ensure_ascii=False))
    (workspace / 'analysis/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False))
    selected = []
    total = 0
    for file in workspace.rglob('*'):
        if file.is_symlink():
            raise RuntimeError('invalid_template_path')
        if not file.is_file() or file == original:
            continue
        relative = file.relative_to(workspace)
        if file.resolve().is_relative_to(workspace.resolve()) is False:
            raise RuntimeError('invalid_template_path')
        total += file.stat().st_size
        selected.append((file, relative))
    if total > 96 * 1024 * 1024 or len(selected) > 10000:
        raise RuntimeError('template_output_limit')
    # Rust publishes each file separately; the list contains no duplicated file contents.
    (output / 'package-files.json').write_text(json.dumps(sorted(str(relative) for _, relative in selected)))
    result = {'schema_version': 1, 'manifest': manifest, 'native_structure': structure}
    encoded = json.dumps(result, ensure_ascii=False)
    if len(encoded.encode()) > 8 * 1024 * 1024:
        raise RuntimeError('template_output_limit')
    (output / 'result.json').write_text(encoded)
except Exception:
    sys.stderr.write('template_extract_failed\n')
    sys.exit(1)
