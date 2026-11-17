"""Purpose: Exercise the built app with isolated temporary storage.
Pattern: HTTP smoke checks with owned subprocesses and temporary files.
Usage: Invoked by scripts/smoke-test.sh.
Related: scripts/smoke-test.sh, backend/src/bootstrap/storage.rs.
"""

import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run(binary):
    result = subprocess.run(
        [binary, '--data-storage-path', 'relative-path'],
        capture_output=True, text=True, timeout=10,
    )
    check(result.returncode != 0, 'Relative storage path must be rejected.')

    test_root = Path(__file__).resolve().parent.parent / 'tests' / '.artifacts'
    test_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='smoke-', dir=test_root) as temporary:
        data = Path(temporary) / 'persistent data'
        data.mkdir()
        marker = data / 'preserved.txt'
        marker.write_text('keep existing data', encoding='utf-8')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        env = {**os.environ, 'APP_LISTEN_ADDRESS': '127.0.0.1', 'APP_PORT': str(port)}
        command = [binary, '--data-storage-path', str(data)]
        base = f'http://127.0.0.1:{port}'

        with (Path(temporary) / 'server.log').open('w+') as log:
            for attempt in range(2):
                process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
                try:
                    for _ in range(100):
                        check(process.poll() is None, 'Server exited before becoming ready.')
                        try:
                            with urlopen(base + '/healthz', timeout=1) as response:
                                health = json.load(response)
                            break
                        except (URLError, TimeoutError):
                            time.sleep(0.1)
                    else:
                        raise RuntimeError('Server did not become ready.')
                    check(health['service'] == 'PreM' and health['status'] == 'ok', 'Invalid health response.')
                    with urlopen(base + '/home', timeout=5) as response:
                        html = response.read().decode()
                    check('<title>PreM</title>' in html, 'Embedded frontend is missing.')
                    for asset in re.findall(r'(?:src|href)="(/home/assets/[^\"]+)"', html):
                        with urlopen(base + asset, timeout=5) as response:
                            check(response.status == 200, f'Missing frontend asset: {asset}')
                    for path in ['/api/v1/unknown', '/home/assets/missing.js']:
                        try:
                            urlopen(base + path, timeout=5)
                            raise RuntimeError(f'Expected HTTP 404 for {path}.')
                        except HTTPError as error:
                            check(error.code == 404, f'Unexpected status for {path}.')
                    duplicate = subprocess.run(command + ['--port', '0'], env=env, capture_output=True, timeout=5)
                    check(duplicate.returncode != 0, 'A second instance used the same storage.')
                    check(marker.read_text(encoding='utf-8') == 'keep existing data', 'Existing data was modified.')
                    check((data / 'blobs' / 'sha256').is_dir(), 'Storage directories are missing.')
                    print(f'PreM smoke {attempt + 1}/2: HTTP, embedded UI, assets, lock and storage passed.')
                except Exception:
                    log.flush()
                    log.seek(0)
                    print(log.read(), file=sys.stderr)
                    raise
                finally:
                    stop(process)


if __name__ == '__main__':
    run(str(Path(sys.argv[1]).resolve()))
