#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Run the room relay locally with wrangler's own Durable Object emulation, no Cloudflare account
# needed: a page served from 127.0.0.1 or localhost connects to ws://127.0.0.1:8787 by itself.
# Wrangler's state and scratch files go under work/relay (gitignored), not into this folder.
#
#   tools/relay/dev-local.sh [--port 8787] [--trace]
#
#   --trace    log the player-to-player packet rate every 2 s (TRACE_TRAFFIC=1 in the Worker)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${MKW_RELAY_RUN:-$ROOT/work/relay}"
port=8787; trace=()
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --trace) trace=(--var TRACE_TRAFFIC:1); shift ;;
    -h|--help) sed -n 3,9p "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$RUN/state"
# The same configuration with an absolute entry point, so wrangler can run from work/relay.
sed "s|\"main\": \"src/index.js\"|\"main\": \"$HERE/src/index.js\"|" "$HERE/wrangler.jsonc" > "$RUN/wrangler-local.jsonc"
grep -q "$HERE/src/index.js" "$RUN/wrangler-local.jsonc" || { echo "could not rewrite main in wrangler.jsonc" >&2; exit 1; }
cd "$RUN"
export WRANGLER_SEND_METRICS=false
echo "Room relay on http://127.0.0.1:$port/ (POST /v1/rooms, WebSocket /v1/rooms/<code>/ws). Ctrl+C stops it."
exec npx --yes wrangler@4 dev --config "$RUN/wrangler-local.jsonc" --persist-to "$RUN/state" \
  --ip 127.0.0.1 --port "$port" "${trace[@]}"
