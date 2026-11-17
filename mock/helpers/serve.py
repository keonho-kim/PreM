# Purpose: Serve the standalone mock reliably during browser review and captures.
# Pattern: Local-only static HTTP server using the Python standard library.
# Usage: python3 mock/helpers/serve.py [--port 5174].
# Related: mock/index.html, mock/helpers/browser.cjs, mock/helpers/README.md.
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class MockServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class MockHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    timeout = 15

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        # Keep request logs from filling a long-lived automation pipe.
        pass


def main():
    parser = argparse.ArgumentParser(description='Preview the PreM mock locally.')
    parser.add_argument('--port', type=int, default=5174)
    options = parser.parse_args()
    directory = Path(__file__).resolve().parents[1]
    handler = partial(MockHandler, directory=str(directory))
    with MockServer(('127.0.0.1', options.port), handler) as server:
        print(f'PreM mock: http://127.0.0.1:{options.port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
