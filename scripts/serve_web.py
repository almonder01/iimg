"""Serve an extracted IIMG web bundle on loopback with explicit module MIME types."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class WebHandler(SimpleHTTPRequestHandler):
    # Windows registry mappings can otherwise label .mjs as text/plain, which
    # browsers reject for ES modules. Do not rely on host MIME configuration.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html", ".mjs": "text/javascript",
                      ".js": "text/javascript", ".wasm": "application/wasm"}


def make_server(directory, port=8000):
    directory = Path(directory).resolve(strict=True)
    if not directory.is_dir():
        raise ValueError("Web directory must be a directory")
    for name in ("index.html", "viewer.mjs", "editor.mjs", "state-editor.mjs", "drag-editor.mjs", "text-editor.mjs", "offline.js", "iimg_web.wasm"):
        if not (directory / name).is_file():
            raise ValueError(f"Missing web asset: {name}; build WASM or extract the complete bundle")
    return ThreadingHTTPServer(("127.0.0.1", port), partial(WebHandler, directory=str(directory)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.cwd())
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Port must be from 0 through 65535 (0 chooses a free port)")
    with make_server(args.directory, args.port) as server:
        print(f"IIMG web viewer: http://127.0.0.1:{server.server_port}/", flush=True)
        print("Local computer only. Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
