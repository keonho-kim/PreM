#!/usr/bin/env python3
# Purpose: Package native PreM with all locally executed runtimes, models and notices.
# Pattern: Allowlisted bundle roots, contained symlinks, relocatable launcher and complete file hashes.
# Usage: python3 scripts/package-release.py vYYYYMMDD [binary-path].
# Related: verify-release.py, release.yml, runtime/document-manifest.json.
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile

def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

ROOT = Path(__file__).resolve().parent.parent
TAG = sys.argv[1]
if not re.fullmatch(r'v\d{8}', TAG):
    raise SystemExit('Release tag must be vYYYYMMDD')
OS = {'Darwin': 'macos', 'Linux': 'linux'}[platform.system()]
ARCH = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]
NAME = f'PreM-{TAG}-{OS}-{ARCH}'
OUT = ROOT / 'release'
DEST = OUT / NAME
if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(parents=True)
RUNTIME = ROOT / 'runtime'
manifest = json.loads((RUNTIME / 'document-manifest.json').read_text())
expected = ('darwin' if OS == 'macos' else 'linux', 'x64' if ARCH == 'amd64' else 'arm64')
if (manifest['platform'], manifest['arch']) != expected:
    raise SystemExit('Runtime target does not match package target')
(DEST / 'bin').mkdir()
binary = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / 'target/release/PreM'
expected_version = f'PreM {TAG[1:5]}.{TAG[5:7]}.{TAG[7:9]}'
if subprocess.check_output([str(binary), '--version'], text=True).strip() != expected_version:
    raise SystemExit('Compiled binary version does not match release tag')
source_dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
if os.environ.get('CI') and source_dirty:
    raise SystemExit('CI release packaging requires a clean source checkout')
shutil.copy2(binary, DEST / 'bin/PreM')
runtime = DEST / 'runtime'
runtime.mkdir()
for name in ['kordoc', 'python-packages', 'ppt-master', 'fonts']:
    shutil.copytree(RUNTIME / name, runtime / name, symlinks=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store', '.git'))
python_home = Path(manifest['python']).parent.parent
shutil.copytree(RUNTIME / python_home, runtime / python_home, symlinks=True,
                ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
(runtime / 'node/bin').mkdir(parents=True)
shutil.copy2(RUNTIME / 'node/bin/node', runtime / 'node/bin/node')
shutil.copy2(RUNTIME / 'node/LICENSE', runtime / 'node/LICENSE')
for source in RUNTIME.iterdir():
    if source.is_file() and source.suffix in ['.mjs', '.py', '.json']:
        shutil.copy2(source, runtime / source.name)
# Native standard C++ dependencies are not guaranteed on a minimal Linux installation.
if OS == 'linux':
    lib = runtime / 'lib'
    lib.mkdir()
    for name in ['libstdc++.so.6', 'libgcc_s.so.1', 'libatomic.so.1']:
        source = subprocess.check_output(['gcc', '-print-file-name=' + name], text=True).strip()
        if not Path(source).is_file():
            raise SystemExit('Missing native library: ' + name)
        shutil.copy2(Path(source).resolve(), lib / name)
    (runtime / 'certs').mkdir()
    shutil.copy2('/etc/ssl/certs/ca-certificates.crt', runtime / 'certs/ca-certificates.crt')
(runtime / 'fonts.conf').write_text('''<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir prefix="relative">fonts</dir>
  <cachedir prefix="xdg">fontconfig</cachedir>
  <alias><family>sans-serif</family><prefer><family>Noto Sans KR</family></prefer></alias>
</fontconfig>
''')
(DEST / 'PreM').write_text('''#!/bin/sh
# Purpose: Start the relocatable PreM bundle with its own tools and fonts.
# Pattern: Resolve the installation root without external commands or package managers.
# Usage: ./PreM --data-storage-path /absolute/writable/path
# Related: bin/PreM, runtime/, RELEASE.json.
set -eu
PREM_ROOT=$(CDPATH= cd -- "${0%/*}" && pwd)
export APP_DOCUMENT_RUNTIME_PATH="$PREM_ROOT/runtime"
export FONTCONFIG_FILE="$PREM_ROOT/runtime/fonts.conf"
export LD_LIBRARY_PATH="$PREM_ROOT/runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# Retain explicit/host trust stores; provide public roots when the Linux base has none.
if [ -f "$PREM_ROOT/runtime/certs/ca-certificates.crt" ] && [ -z "${SSL_CERT_FILE:-}" ] && [ -z "${SSL_CERT_DIR:-}" ]; then
  if [ ! -s /etc/ssl/certs/ca-certificates.crt ] && [ ! -s /etc/pki/tls/certs/ca-bundle.crt ]; then
    export SSL_CERT_FILE="$PREM_ROOT/runtime/certs/ca-certificates.crt"
  fi
fi
PREM_EXPECT_STORAGE=0
for PREM_ARG in "$@"; do
  if [ "$PREM_EXPECT_STORAGE" = 1 ]; then export XDG_CACHE_HOME="$PREM_ARG/config/cache"; PREM_EXPECT_STORAGE=0; fi
  case "$PREM_ARG" in
    --data-storage-path) PREM_EXPECT_STORAGE=1 ;;
    --data-storage-path=*) export XDG_CACHE_HOME="${PREM_ARG#*=}/config/cache" ;;
  esac
done
exec "$PREM_ROOT/bin/PreM" "$@"
''')
(DEST / 'PreM').chmod(0o755)
(DEST / 'tools').mkdir()
shutil.copy2(ROOT / 'scripts/storage-backup.py', DEST / 'tools/storage-backup.py')
shutil.copytree(ROOT / 'scripts/storage_backup', DEST / 'tools/storage_backup',
                ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
(DEST / 'PreM-maintenance').write_text(f'''#!/bin/sh
# Purpose: Run offline backup/restore with the bundled Python interpreter.
# Pattern: Relocatable maintenance entry point; never uses a system package manager.
# Usage: ./PreM-maintenance backup --data-storage-path /data --output /backups/snapshot.tar.gz
# Related: tools/storage-backup.py, runtime/.
set -eu
PREM_ROOT=$(CDPATH= cd -- "${{0%/*}}" && pwd)
export PYTHONDONTWRITEBYTECODE=1
export LD_LIBRARY_PATH="$PREM_ROOT/runtime/lib${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}"
exec "$PREM_ROOT/runtime/{manifest['python']}" "$PREM_ROOT/tools/storage-backup.py" "$@"
''')
(DEST / 'PreM-maintenance').chmod(0o755)
shutil.copy2(ROOT / 'README.md', DEST / 'README.md')
notices = DEST / 'licenses'
shutil.copytree(ROOT / 'licenses', notices)
if OS == 'linux':
    for name in ['libstdc++6', 'libgcc-s1', 'libatomic1', 'ca-certificates']:
        source = Path('/usr/share/doc') / name / 'copyright'
        target = notices / 'system' / name
        target.mkdir(parents=True)
        shutil.copy2(source, target / 'copyright')
shutil.copy2(ROOT / 'frontend/THIRD_PARTY_NOTICES.md', notices / 'frontend-NOTICES.md')
metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--format-version', '1', '--locked'], cwd=ROOT))
packages = []
for package in metadata['packages']:
    packages.append({k: package.get(k) for k in ['name', 'version', 'license', 'repository', 'source']})
    folder = Path(package['manifest_path']).parent
    sources = [p for p in folder.iterdir() if p.is_file() and p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE'))]
    if package.get('license_file'):
        sources.append(folder / package['license_file'])
    for source in set(sources):
        target = notices / 'rust' / (package['name'] + '-' + package['version']) / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
node_packages = []
for base in [ROOT / 'node_modules/.pnpm', RUNTIME / 'kordoc/node_modules']:
    for file in base.rglob('package.json'):
        try:
            data = json.loads(file.read_text())
        except (ValueError, OSError):
            continue
        name, version = data.get('name'), data.get('version')
        if not name or not version:
            continue
        node_packages.append({'name': name, 'version': version, 'license': data.get('license')})
        for source in file.parent.iterdir():
            if source.is_file() and source.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE', 'OFL')):
                target = notices / 'npm' / (name.replace('/', '__') + '-' + version) / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
(DEST / 'DEPENDENCIES.json').write_text(json.dumps({'rust': packages, 'npm': node_packages, 'runtime': manifest}, indent=2) + '\n')
# Reject accidental absolute/outside links before publishing any archive.
for file in DEST.rglob('*'):
    if file.is_symlink() and not file.resolve().is_relative_to(DEST.resolve()):
        raise SystemExit('Non-relocatable symlink: ' + str(file))
files = {}
for file in sorted(DEST.rglob('*')):
    key = file.relative_to(DEST).as_posix()
    if file.is_symlink():
        files[key] = {'symlink': os.readlink(file)}
    elif file.is_file():
        files[key] = {'sha256': digest(file)}
release = {'tag': TAG, 'platform': OS, 'arch': ARCH, 'source_dirty': source_dirty,
           'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
           'minimum_os': 'macOS 14' if OS == 'macos' else 'Linux glibc 2.39+ (Ubuntu 24.04+)', 'files': files}
(DEST / 'RELEASE.json').write_text(json.dumps(release, indent=2) + '\n')
archive = OUT / (NAME + '.tar.gz')
with tarfile.open(archive, 'w:gz', compresslevel=6) as tar:
    tar.add(DEST, arcname=NAME)
if archive.stat().st_size >= 2 * 1024 ** 3:
    raise SystemExit('Archive exceeds GitHub asset size limit')
checksum = digest(archive)
(OUT / (NAME + '.sha256')).write_text(f'{checksum}  {archive.name}\n')
print(f'Packaged {archive.name}: {archive.stat().st_size // 1024**2} MiB, sha256 {checksum}')
