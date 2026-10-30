#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Upload a staged release folder to the private R2 bucket behind the page Worker.

    upload-r2.py --site DIR --bucket NAME --config wrangler.jsonc [--deploy-worker] [--jobs N]
                 [--state FILE] [--dry-run]

What is uploaded: the page files found in DIR (WiiCompiled.html/.js/.wasm/.data, the disc reader
mkw_disc.wasm and mkw_disc_worker.js, and index.html when a landing page is staged) and, when DIR
has a game folder (tools/hosting/stage-game.sh), its manifests and every file they name. Files
whose size and content (or, for the disc files, size and mtime) match the last upload are skipped;
the record is deployed.json next to DIR (or --state). Uploads go in dependency order, so a page
or manifest is never live before the files it refers to.

Needs Node (npx fetches wrangler 4) and a `npx wrangler@4 login`. The bucket holds translated
game code: keep the Worker in front of it behind Cloudflare Access (docs/hosting.md).
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys

PAGE_FILES = ("index.html", "WiiCompiled.html", "WiiCompiled.js", "WiiCompiled.wasm", "WiiCompiled.data",
              "mkw_disc.wasm", "mkw_disc_worker.js")

# Lower phases upload first: disc files and content-addressed blobs, then the manifests that
# name them, then the game binaries, the loader, and last the pages.
PHASES = (
    lambda key: key.endswith(".html"),
    lambda key: key == "WiiCompiled.js" or key == "mkw_disc_worker.js",
    lambda key: key in ("WiiCompiled.wasm", "WiiCompiled.data", "mkw_disc.wasm"),
    lambda key: key.startswith("game/manifest"),
)


def phase(key):
    for number, matches in enumerate(reversed(PHASES)):
        if matches(key):
            return len(PHASES) - number
    return 0


def game_keys(site):
    """The keys a staged game folder needs: both manifests, every listed file, packs, previews."""
    game = os.path.join(site, "game")
    v2 = os.path.join(game, "manifest-v2.txt")
    if not os.path.isfile(v2):
        return []
    keys = ["game/manifest-v2.txt"]
    if os.path.isfile(os.path.join(game, "manifest.txt")):
        keys.append("game/manifest.txt")
    with open(v2, encoding="utf-8") as manifest:
        for line in manifest:
            line = line.rstrip("\n")
            if line.startswith("f "):
                keys.append("game/" + line.split(" ", 2)[2])
            elif line.startswith("u "):
                keys.append("game/" + json.loads(line[2:])[1])
            elif line.startswith("p "):
                keys.append("game/" + json.loads(line[2:])[1])
    if os.path.isfile(os.path.join(game, "background.jpg")):
        keys.append("game/background.jpg")
    return list(dict.fromkeys(keys))


def staged_keys(site):
    keys = [name for name in PAGE_FILES if os.path.isfile(os.path.join(site, name))]
    if "WiiCompiled.html" not in keys:
        sys.exit("no WiiCompiled.html in %s: run tools/hosting/stage-release.sh" % site)
    return keys + game_keys(site)


def fingerprint(site, key):
    """Disc files are large and never edited: size and mtime. Everything else is hashed."""
    path = os.path.join(site, key)
    info = os.stat(path)
    if key.startswith("game/DATA/"):
        return "%d:%d" % (info.st_size, info.st_mtime_ns)
    digest = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return "%d:%s" % (info.st_size, digest.hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site", required=True, help="the staged folder (tools/hosting/stage-release.sh)")
    parser.add_argument("--bucket", required=True, help="the R2 bucket")
    parser.add_argument("--config", required=True, help="the Worker's wrangler.jsonc")
    parser.add_argument("--state", help="upload record (default: deployed.json next to --site)")
    parser.add_argument("--deploy-worker", action="store_true", help="also `wrangler deploy` the Worker first")
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true", help="list what would be uploaded, upload nothing")
    args = parser.parse_args()

    site = os.path.abspath(args.site)
    config = os.path.abspath(args.config)
    state_path = os.path.abspath(args.state or os.path.join(os.path.dirname(site), "deployed.json"))

    def wrangler(*command):
        return subprocess.run(["npx", "--yes", "wrangler@4", *command, "--config", config],
                              cwd=os.path.dirname(config), capture_output=True, text=True)

    if args.deploy_worker and not args.dry_run:
        result = wrangler("deploy")
        print((result.stdout or result.stderr).strip()[-800:])
        if result.returncode != 0:
            sys.exit("Worker deploy failed")

    try:
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
    except FileNotFoundError:
        state = {}

    keys = staged_keys(site)
    todo = [(key, fingerprint(site, key)) for key in keys]
    todo = [(key, fp) for key, fp in todo if state.get(key) != fp]
    total = sum(os.path.getsize(os.path.join(site, key)) for key, _ in todo)
    print("%d of %d files to upload (%.1f MB) from %s" % (len(todo), len(keys), total / 1e6, site))
    if args.dry_run:
        for key, _ in todo[:40]:
            print("  " + key)
        if len(todo) > 40:
            print("  ... and %d more" % (len(todo) - 40))
        return
    if not todo:
        print("Nothing to do.")
        return

    def put(item):
        key, fp = item
        return key, fp, wrangler("r2", "object", "put", args.bucket + "/" + key, "--file", os.path.join(site, key), "--remote")

    def save_state():
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=0, sort_keys=True)

    done = failed = 0
    with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        for stage in range(len(PHASES) + 1):
            batch = [item for item in todo if phase(item[0]) == stage]
            for key, fp, result in pool.map(put, batch):
                done += 1
                if result.returncode == 0:
                    state[key] = fp
                else:
                    failed += 1
                    print("FAILED %s: %s" % (key, (result.stderr or result.stdout).strip()[-400:]))
                if done % 50 == 0 or done == len(todo):
                    print("%d/%d" % (done, len(todo)), flush=True)
            if batch:
                save_state()
            if failed:
                break
    if failed:
        sys.exit("%d uploads failed; run again to retry them" % failed)
    print("Uploaded %d files; record in %s" % (done, state_path))


if __name__ == "__main__":
    main()
