# Purpose: Read and write verified storage archives without following paths or links outside staging.
# Pattern: Regular-file allowlist, content hashes and exclusive publication.
# Usage: Imported by offline backup/restore commands; standard Python library only.
# Related: core.py, ../storage-backup.py.
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile

def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def pack(folder, destination):
    files = {p.relative_to(folder).as_posix(): {'size': p.stat().st_size, 'sha256': digest(p)}
             for p in sorted(folder.rglob('*')) if p.is_file()}
    manifest = folder / 'BACKUP.json'
    with manifest.open('x') as stream:
        stream.write(json.dumps({'schema': 1, 'files': files}, indent=2) + '\n')
    temporary = folder.parent / 'snapshot.tar.gz'
    with tarfile.open(temporary, 'w:gz') as archive:
        for name in ['BACKUP.json', *files]:
            archive.add(folder / name, arcname=name, recursive=False)
    temporary.chmod(0o600)
    # A destination created concurrently is never overwritten.
    os.link(temporary, destination)
    return len(files)

def unpack(source, folder):
    with tarfile.open(source, 'r:gz') as archive:
        entries = {}
        for item in archive:
            path = PurePosixPath(item.name)
            if (not item.isfile() or path.is_absolute() or '..' in path.parts
                    or str(path) != item.name or '\\' in item.name
                    or item.name in entries or item.name == '.instance.lock'):
                raise ValueError('Backup contains an unsafe or duplicate entry')
            entries[item.name] = item
            if len(entries) > 100000:
                raise ValueError('Backup exceeds 100000 files')
        info = entries.pop('BACKUP.json', None)
        if info is None or info.size > 16 * 1024 * 1024:
            raise ValueError('Backup manifest is missing or oversized')
        manifest = json.load(archive.extractfile(info))
        if manifest.get('schema') != 1 or not isinstance(manifest.get('files'), dict):
            raise ValueError('Unsupported backup manifest')
        files = manifest['files']
        if set(files) != set(entries):
            raise ValueError('Backup file inventory does not match')
        if sum(item.size for item in entries.values()) >= shutil.disk_usage(folder).free:
            raise ValueError('Insufficient disk space for restore')
        for name, item in entries.items():
            expected = files[name]
            if item.size != expected['size']:
                raise ValueError('Backup file size mismatch')
            target = folder / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open('xb') as output, archive.extractfile(item) as input_:
                shutil.copyfileobj(input_, output)
            target.chmod(0o600)
            if digest(target) != expected['sha256']:
                raise ValueError('Backup checksum mismatch')
    return len(files)
