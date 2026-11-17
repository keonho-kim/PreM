#!/usr/bin/env python3
# Purpose: Provide explicit offline backup and new-path restore for PreM storage.
# Pattern: No dependencies beyond Python; fail closed on active storage or overwrite requests.
# Usage: storage-backup.py backup --data-storage-path /data --output /backups/snapshot.tar.gz
# Related: storage_backup/, dev-docs/06-development-operations.md.
import argparse
import sys
from storage_backup.core import backup, restore

def main():
    parser = argparse.ArgumentParser(description='PreM offline storage maintenance')
    commands = parser.add_subparsers(dest='command', required=True)
    save = commands.add_parser('backup')
    save.add_argument('--data-storage-path', required=True)
    save.add_argument('--output', required=True)
    save.add_argument('--secret-key-file')
    load = commands.add_parser('restore')
    load.add_argument('--archive', required=True)
    load.add_argument('--data-storage-path', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'backup':
            count = backup(args.data_storage_path, args.output, args.secret_key_file)
        else:
            count = restore(args.archive, args.data_storage_path)
        print(f'PreM {args.command}: verified {count} files')
    except Exception as error:
        print(f'PreM maintenance failed: {error}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
