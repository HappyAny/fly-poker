"""Local development only; the private deployment uses a separate asset allowlist."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.wgsl': 'text/plain', '.gz': 'application/gzip'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8891)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / 'dist'
    print(f'Open http://localhost:{args.port}/')
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root))).serve_forever()
