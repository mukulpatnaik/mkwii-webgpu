#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Serve a staged folder on 127.0.0.1 the way the page needs: for local play and tests.

    tools/hosting/serve.py [FOLDER] [--port 8000] [--latency-ms 0]

Every response carries the cross-origin isolation headers (threads need SharedArrayBuffer, which
browsers only hand to an isolated page), .wasm is application/wasm, single byte ranges are
answered (the game reads a staged disc folder in ranges), `/` goes to the landing page or the game
page, and POST /log prints what a page opened with ?log forwards from its console. --latency-ms
delays the game folder's files to imitate a far-away host. It binds 127.0.0.1 only: the game
stays on this machine. Access control is not this server's job; see docs/hosting.md for hosting.
"""

import argparse
import functools
import http.server
import os
import posixpath
import re
import sys
import time
import urllib.parse

RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".wasm": "application/wasm", ".json": "application/json",
    ".txt": "text/plain; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg",
    ".png": "image/png", ".data": "application/octet-stream",
}
ISOLATION = (
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Embedder-Policy", "require-corp"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    root = "."
    latency = 0.0

    # -- helpers -------------------------------------------------------------------------------
    def local_path(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        path = posixpath.normpath(re.sub(r"/{2,}", "/", path))  # the game asks for game//DATA/...
        parts = [p for p in path.split("/") if p and p not in (".", "..")]
        return os.path.join(self.root, *parts), "/" + "/".join(parts)

    def begin(self, status, headers, length=None):
        self.send_response(status)
        for name, value in ISOLATION:
            self.send_header(name, value)
        for name, value in headers:
            self.send_header(name, value)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()

    def plain(self, status, message, extra=()):
        body = (message + "\n").encode()
        self.begin(status, [("Content-Type", "text/plain; charset=utf-8"), *extra], len(body))
        if self.command != "HEAD":
            self.wfile.write(body)

    def redirect(self, location):
        self.begin(302, [("Location", location), ("Content-Type", "text/plain; charset=utf-8")], 0)

    # -- requests ------------------------------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path, logical = self.local_path()
        if logical == "/":
            landing = os.path.isfile(os.path.join(self.root, "index.html"))
            return self.redirect("/index.html" if landing else "/WiiCompiled.html")
        if logical == "/log":
            return self.plain(405, "Method not allowed", [("Allow", "POST")])
        if not os.path.isfile(path):
            return self.plain(404, "Not found")
        if self.latency and logical.startswith("/game/") and "manifest" not in logical:
            time.sleep(self.latency)
        size = os.path.getsize(path)
        content_type = TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        headers = [("Content-Type", content_type), ("Accept-Ranges", "bytes"), ("Cache-Control", "no-cache")]
        start, end = 0, size - 1
        status = 200
        match = RANGE.match(self.headers.get("Range", "").strip())
        if match:
            first, last = match.groups()
            if first == "" and last == "":
                return self.plain(400, "Bad range")
            if first == "":
                start = max(0, size - int(last))
            else:
                start = int(first)
                if last:
                    end = min(int(last), size - 1)
            if start >= size or start > end:
                return self.plain(416, "Range not satisfiable", [("Content-Range", "bytes */%d" % size)])
            status = 206
            headers.append(("Content-Range", "bytes %d-%d/%d" % (start, end, size)))
        length = end - start + 1
        self.begin(status, headers, length)
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_POST(self):
        _, logical = self.local_path()
        if logical != "/log":
            return self.plain(404, "Not found")
        length = int(self.headers.get("Content-Length", 0))
        text = self.rfile.read(min(length, 1 << 16)).decode("utf-8", "replace")
        for line in text.splitlines():
            print("[page] " + line, flush=True)
        self.begin(204, [])

    def log_message(self, fmt, *args):
        byte_range = self.headers.get("Range", "") if hasattr(self, "headers") else ""
        suffix = (" [" + byte_range + "]") if byte_range else ""
        sys.stderr.write("%s %s%s\n" % (self.log_date_time_string(), fmt % args, suffix))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", nargs="?", default="work/sites/release/public")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--latency-ms", type=float, default=0.0, help="delay the game folder's files")
    args = parser.parse_args()
    root = os.path.abspath(args.folder)
    if not os.path.isfile(os.path.join(root, "WiiCompiled.html")):
        sys.exit("no WiiCompiled.html in %s (tools/hosting/stage-release.sh stages one)" % root)
    handler = functools.partial(Handler)
    Handler.root = root
    Handler.latency = args.latency_ms / 1000.0
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print("Serving %s at http://127.0.0.1:%d/  (Ctrl+C stops)" % (root, args.port), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
