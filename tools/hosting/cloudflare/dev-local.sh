#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Run the page Worker locally with wrangler's own R2 emulation, no Cloudflare account needed:
# the release folder's page files are copied into a local bucket under work/hosting/cloudflare/state
# and the Worker serves them on 127.0.0.1. For testing the Cloudflare path end to end before
# deploying (a staged game folder is not copied: that path is covered by the nginx checks).
#
#   tools/hosting/cloudflare/dev-local.sh [--site DIR] [--port N]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${MKW_CF_RUN:-$ROOT/work/hosting/cloudflare}"
site="$ROOT/work/sites/release/public"; port=8787
while [ $# -gt 0 ]; do
  case "$1" in
    --site) site="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    -h|--help) sed -n 3,8p "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -f "$site/WiiCompiled.html" ] || { echo "no WiiCompiled.html in $site: run tools/hosting/stage-release.sh" >&2; exit 1; }
site="$(cd "$site" && pwd)"

mkdir -p "$RUN/state"
sed -e "s|@WORKER@|mkw-web-local|g" -e "s|@BUCKET@|mkw-web-local|g" -e "s|@WORKER_JS@|$HERE/worker.js|g" \
    "$HERE/wrangler.jsonc.in" > "$RUN/wrangler-local.jsonc"
cd "$RUN"
for f in index.html WiiCompiled.html WiiCompiled.js WiiCompiled.wasm WiiCompiled.data mkw_disc.wasm mkw_disc_worker.js; do
  [ -f "$site/$f" ] || continue
  npx --yes wrangler@4 r2 object put "mkw-web-local/$f" --file "$site/$f" --local --persist-to "$RUN/state" \
      --config "$RUN/wrangler-local.jsonc" >/dev/null
  echo "local bucket: $f"
done
echo "Worker on http://127.0.0.1:$port/ (local R2 in $RUN/state). Ctrl+C stops it."
exec npx --yes wrangler@4 dev --config "$RUN/wrangler-local.jsonc" --persist-to "$RUN/state" --ip 127.0.0.1 --port "$port"
