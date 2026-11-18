#!/usr/bin/env python3
# Purpose: Verify a relocated archive without development Node/Python or networked tools.
# Pattern: Full integrity checks, bundled native/OCR/PPT probes and isolated HTTP restart smoke.
# Usage: python3 scripts/release/verify.py release/PreM-vYYYYMMDD-os-arch.tar.gz
# Related: package.py, tests/fixtures/documents/.
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import urlopen

def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

ROOT = Path(__file__).resolve().parents[2]
scratch = ROOT / 'tests/.artifacts'
scratch.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='relocated bundle ', dir=scratch) as temporary:
    work = Path(temporary)
    with tarfile.open(Path(sys.argv[1]).resolve()) as tar:
        for member in tar.getmembers():
            target = (work / member.name).resolve()
            assert target.is_relative_to(work.resolve()), member.name
            assert member.isfile() or member.isdir() or member.issym() or member.islnk(), member.name
            if member.issym():
                assert (target.parent / member.linkname).resolve().is_relative_to(work.resolve())
            if member.islnk():
                assert (work / member.linkname).resolve().is_relative_to(work.resolve())
        tar.extractall(work)
    bundle = next(p for p in work.iterdir() if p.is_dir())
    manifest = json.loads((bundle / 'RELEASE.json').read_text())
    for name, expected in manifest['files'].items():
        file = bundle / name
        assert file.resolve().is_relative_to(bundle.resolve()), name
        if 'symlink' in expected:
            assert file.is_symlink() and os.readlink(file) == expected['symlink'], name
        else:
            assert digest(file) == expected['sha256'], name
    runtime = bundle / 'runtime'
    tools = json.loads((runtime / 'document-manifest.json').read_text())
    model_cache = work / 'ocr-models'
    shutil.copytree(runtime / 'kordoc/models', model_cache)
    env = {**os.environ, 'PATH': '/nonexistent', 'HOME': str(work),
           'KORDOC_OFFLINE': '1', 'KORDOC_MODEL_CACHE': str(model_cache),
           'PYTHONDONTWRITEBYTECODE': '1', 'FONTCONFIG_FILE': str(runtime / 'fonts.conf'),
           'XDG_CACHE_HOME': str(work / 'cache'), 'LD_LIBRARY_PATH': str(runtime / 'lib')}
    env.pop('APP_DOCUMENT_RUNTIME_PATH', None)
    node, python = str(runtime / tools['node']), str(runtime / tools['python'])
    def run(command):
        result = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr[-5000:] + result.stdout[-5000:])
        return result.stdout
    print('Archive integrity verified; probing bundled native tools.', flush=True)
    probe = work / 'native-probe.mjs'
    probe.write_text('''import {createRequire} from 'node:module';
import path from 'node:path';
const root=process.argv[2];
const require=createRequire(path.join(root,'kordoc/package.json'));
const sharp=require('sharp');
const ort=require('onnxruntime-node');
for(const name of ['det.onnx','rec_korean.onnx']) {
 const session=await ort.InferenceSession.create(path.join(root,'kordoc/models/ppocr',name),{executionProviders:['cpu'],intraOpNumThreads:1});
 await session.release();
}
await sharp(Buffer.from('<svg width="200" height="60"><text x="5" y="35" font-family="Noto Sans KR">한국어 PreM</text></svg>')).png().toFile(path.join(process.argv[3],'font.png'));
''')
    run([node, '--permission', '--allow-addons', '--allow-worker',
         f'--allow-fs-read={bundle}', f'--allow-fs-read={work}', f'--allow-fs-write={work}',
         str(probe), str(runtime), str(work)])
    run([python, '-c', 'import sys; sys.path.insert(0,sys.argv[1]); import pptx,lxml,PIL; assert pptx.__version__=="1.0.2"', str(runtime / 'python-packages')])
    output = work / 'template-test'
    output.mkdir()
    # Generate a real PPTX with only bundled Python packages, then reimport and rasterize it.
    source = work / 'template.pptx'
    run([python, '-c', 'import sys; sys.path.insert(0,sys.argv[1]); from pptx import Presentation; p=Presentation(); s=p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text="한국어 PreM"; s.placeholders[1].text="Offline release verification"; p.save(sys.argv[2])', str(runtime / 'python-packages'), str(source)])
    run([python, str(runtime / 'template-extract.py'), str(runtime), str(source), str(output)])
    run([node, '--permission', '--allow-addons', '--allow-worker', f'--allow-fs-read={bundle}',
         f'--allow-fs-read={work}', f'--allow-fs-write={work}', str(runtime / 'template-previews.mjs'), str(runtime), str(output)])
    assert json.loads((output / 'previews.json').read_text()), 'PPT preview missing'
    print('Native OCR models and PPT rendering verified; checking document formats.', flush=True)
    for name in ['text.pdf', 'scan.pdf', 'office.docx', 'sheet.xlsx', 'korean.hwpx', 'nested.hwp']:
        sample = work / name
        sample.write_bytes((ROOT / 'tests/fixtures/documents' / name).read_bytes())
        extracted = work / ('extract-' + name)
        extracted.mkdir()
        run([node, '--permission', '--allow-addons', '--allow-worker',
             f'--allow-fs-read={bundle}', f'--allow-fs-read={work}', f'--allow-fs-write={work}',
             str(runtime / 'document-extract.mjs'), str(sample), str(extracted)])
        assert (extracted / 'result.json').is_file(), 'Document extraction failed: ' + name
    with socket.socket() as socket_:
        socket_.bind(('127.0.0.1', 0))
        port = socket_.getsockname()[1]
    data = work / 'data'
    args = [str(bundle / 'PreM'), '--data-storage-path', str(data), '--listen-address', '127.0.0.1', '--port', str(port)]
    for attempt in range(2):
        process = subprocess.Popen(args, cwd=work, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(200):
                if process.poll() is not None:
                    error = process.stderr.read()
                    error = re.sub(r'(PreM Admin token:)\s*\S+', r'\1 [redacted]', error)
                    raise RuntimeError('Packaged server exited before ready: ' + error[-5000:])
                try:
                    with urlopen(f'http://127.0.0.1:{port}/healthz', timeout=1) as response:
                        health = json.load(response)
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Packaged server timed out')
            assert health['service'] == 'PreM' and health['status'] == 'ok'
            with urlopen(f'http://127.0.0.1:{port}/home/', timeout=5) as response:
                html = response.read().decode()
            assert '<title>PreM</title>' in html
        finally:
            process.terminate()
            try:
                process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
    archive = work / 'backup.tar.gz'
    restored = work / 'restored-data'
    run([str(bundle / 'PreM-maintenance'), 'backup', '--data-storage-path', str(data), '--output', str(archive)])
    run([str(bundle / 'PreM-maintenance'), 'restore', '--archive', str(archive), '--data-storage-path', str(restored)])
    assert (restored / 'config/secret.key').read_bytes() == (data / 'config/secret.key').read_bytes()
    assert (restored / 'db/app.sqlite').is_file()
    assert (data / 'db/app.sqlite').is_file()
    print('PASS: relocated archive hashes, bundled Node/Python/Sharp/ONNX OCR models, Korean fonts, scanned PDF/Office/HWP extraction, native PPTX/PNG and HTTP restart and offline backup/restore with no development tools in PATH.')
