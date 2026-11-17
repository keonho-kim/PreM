# Purpose: Snapshot and restore SQLite, blobs and encryption keys while the app is stopped.
# Pattern: Same exclusive instance lock as PreM, coherent SQLite backup and new-path-only restore.
# Usage: Called by the maintenance CLI; never operates on a running application's files.
# Related: archive.py, backend/src/adapters/filesystem/storage.rs.
from contextlib import contextmanager, closing
import fcntl
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from .archive import pack, unpack

def absolute(value):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink():
        raise ValueError('Use an absolute path without a symlink at its root')
    return path

def check_database(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('SQLite foreign-key check failed')

def check_snapshot(folder):
    key = folder / 'config/secret.key'
    if not key.is_file() or key.stat().st_size != 32:
        raise ValueError('A complete 32-byte encryption key is required')
    check_database(folder / 'db/app.sqlite')

@contextmanager
def storage_lock(root):
    fd = os.open(root / '.instance.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Stop PreM before taking an offline backup') from None
        yield
    finally:
        os.close(fd)

def backup(storage, destination, secret_key=None):
    root, output = absolute(storage), absolute(destination)
    if not root.is_dir() or output.exists() or not output.parent.is_dir():
        raise ValueError('Storage must exist and backup destination must be a new file')
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError('Store backups outside application storage')
    with storage_lock(root), tempfile.TemporaryDirectory(prefix='.prem-backup-', dir=output.parent) as scratch:
        stage = Path(scratch) / 'data'
        stage.mkdir(mode=0o700)
        for current, dirs, files in os.walk(root, followlinks=False):
            current = Path(current)
            relative = current.relative_to(root)
            for name in dirs + files:
                if (current / name).is_symlink():
                    raise ValueError('Application storage contains a symlink')
            if current == root:
                dirs[:] = [name for name in dirs if name not in ('work', 'tmp', 'logs')]
            if relative == Path('config'):
                dirs[:] = [name for name in dirs if name not in ('kordoc-cache', 'cache')]
            for name in files:
                file = current / name
                if not file.is_file():
                    raise ValueError('Storage contains a non-regular file')
                if relative == Path('.') and name == '.instance.lock':
                    continue
                if relative == Path('db') and name in ('app.sqlite', 'app.sqlite-wal', 'app.sqlite-shm', 'app.sqlite-journal'):
                    continue
                target = stage / relative / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                shutil.copyfile(file, target)
                target.chmod(0o600)
        if secret_key:
            key = Path(secret_key)
            if not key.is_absolute() or not key.is_file() or key.stat().st_size != 32:
                raise ValueError('External key must be an absolute path to a 32-byte file')
            (stage / 'config').mkdir(exist_ok=True)
            shutil.copyfile(key, stage / 'config/secret.key')
            (stage / 'config/secret.key').chmod(0o600)
        (stage / 'db').mkdir(exist_ok=True)
        # WAL recovery may need sidecar files even for a read snapshot; the instance lock excludes writers.
        with closing(sqlite3.connect((root / 'db/app.sqlite').as_uri() + '?mode=rw', uri=True)) as original:
            with closing(sqlite3.connect(stage / 'db/app.sqlite')) as snapshot:
                original.backup(snapshot)
                snapshot.execute('PRAGMA journal_mode=DELETE')
        check_snapshot(stage)
        return pack(stage, output)

def restore(source, destination):
    archive, target = absolute(source), absolute(destination)
    if not archive.is_file() or target.exists() or not target.parent.is_dir():
        raise ValueError('Restore requires an archive and a new storage path with an existing parent')
    with tempfile.TemporaryDirectory(prefix='.prem-restore-', dir=target.parent) as scratch:
        stage = Path(scratch) / 'data'
        stage.mkdir(mode=0o700)
        count = unpack(archive, stage)
        check_snapshot(stage)
        # Reserve the new path exclusively; never replace an existing directory.
        target.mkdir(mode=0o700)
        with storage_lock(target):
            if any(entry.name != '.instance.lock' for entry in target.iterdir()):
                raise ValueError('Restore destination changed concurrently')
            try:
                for entry in stage.iterdir():
                    os.rename(entry, target / entry.name)
            except BaseException:
                shutil.rmtree(target)
                raise
        return count
