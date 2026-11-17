# Purpose: Validate stopped-server snapshot consistency, lock exclusion and unsafe restore rejection.
# Pattern: Temporary SQLite/blob/key fixtures; production storage is never used.
# Usage: python3 tests/helpers/storage-backup.test.py.
# Related: scripts/storage_backup/, scripts/storage-backup.py.
import fcntl
import io
import os
from pathlib import Path
import sqlite3
import sys
import tarfile
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from storage_backup.core import backup, restore

class StorageBackup(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tests/.artifacts').mkdir(exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(dir=ROOT / 'tests/.artifacts', prefix='backup-test-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.data = self.root / 'original'
        for folder in ['db', 'config', 'blobs/sha256', 'work']:
            (self.data / folder).mkdir(parents=True)
        (self.data / 'config/secret.key').write_bytes(os.urandom(32))
        (self.data / 'blobs/sha256/document').write_bytes(b'original document')
        (self.data / 'work/temporary').write_text('disposable')
        with sqlite3.connect(self.data / 'db/app.sqlite') as db:
            db.execute('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT)')
            db.execute("INSERT INTO records VALUES(1,'saved')")
        self.archive = self.root / 'snapshot.tar.gz'
    def test_complete_snapshot_restores_without_touching_original(self):
        backup(self.data, self.archive)
        restored = self.root / 'restored'
        restore(self.archive, restored)
        for name in ['config/secret.key', 'blobs/sha256/document']:
            self.assertEqual((self.data/name).read_bytes(), (restored/name).read_bytes())
        self.assertFalse((restored/'work').exists())
        self.assertEqual((restored/'config/secret.key').stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(restored/'db/app.sqlite') as db:
            self.assertEqual(db.execute('SELECT value FROM records').fetchone()[0], 'saved')
        with self.assertRaises(ValueError): restore(self.archive, restored)
    def test_active_lock_and_symlinks_are_rejected(self):
        with (self.data/'.instance.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(ValueError): backup(self.data, self.archive)
        (self.data/'outside').symlink_to(self.root)
        with self.assertRaises(ValueError): backup(self.data, self.archive)
        self.assertFalse(self.archive.exists())
    def test_traversal_and_tampered_archives_never_publish_storage(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            entry = tarfile.TarInfo('../escaped')
            entry.size = 4
            archive.addfile(entry, io.BytesIO(b'evil'))
        with self.assertRaises(ValueError): restore(self.archive, self.root/'restored')
        self.assertFalse((self.root/'escaped').exists())
        self.assertFalse((self.root/'restored').exists())
    def test_modified_blob_is_rejected_before_restore_publication(self):
        backup(self.data, self.archive)
        altered = self.root / 'altered.tar.gz'
        with tarfile.open(self.archive, 'r:gz') as source, tarfile.open(altered, 'w:gz') as output:
            for item in source:
                payload = source.extractfile(item).read()
                if item.name == 'blobs/sha256/document': payload = b'x' * len(payload)
                output.addfile(item, io.BytesIO(payload))
        with self.assertRaises(ValueError): restore(altered, self.root / 'restored')
        self.assertFalse((self.root / 'restored').exists())
    def test_wal_database_is_backed_up_as_a_self_contained_snapshot(self):
        with sqlite3.connect(self.data / 'db/app.sqlite') as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute("INSERT INTO records VALUES(2,'WAL record')")
        backup(self.data, self.archive)
        restore(self.archive, self.root / 'restored')
        with sqlite3.connect(self.root / 'restored/db/app.sqlite') as db:
            self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0], 2)
        with self.assertRaises(ValueError): backup(self.data, self.archive)
    def test_external_key_is_included_as_restore_default(self):
        external = self.root/'external.key'
        external.write_bytes(os.urandom(32))
        backup(self.data, self.archive, external)
        restore(self.archive, self.root/'restored')
        self.assertEqual((self.root/'restored/config/secret.key').read_bytes(),external.read_bytes())

if __name__ == '__main__': unittest.main()
