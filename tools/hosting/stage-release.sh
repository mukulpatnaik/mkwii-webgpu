#!/usr/bin/env bash
# Stage a release folder: the six page files the browser build produces, and nothing from the
# disc. Players pick their own disc image in the page. With --with-game the folder also serves
# the owner's staged game folder (fetch mode), for a host that should stream the extracted disc.
#
#   tools/hosting/stage-release.sh [--with-game] [--rooms-host HOST] [OUT]
#
#   OUT          folder to serve                 (default work/sites/release/public)
#   --rooms-host the room relay a hosted page uses for online play (tools/relay deployed to your
#                Cloudflare account, e.g. mkw-rooms.<your-subdomain>.workers.dev); written into the
#                page's <meta name="mkw-rooms-host"> tag. Local pages use 127.0.0.1:8787 regardless.
#   BUILD_DIR    the Emscripten build to take the files from (default work/Wiicompiled/build-web)
#   STAGED_GAME  the staged game folder for --with-game
#                (default work/sites/game, written by tools/hosting/stage-game.sh)
#
# The .wasm contains translated game code: the folder is private. Host it only behind access
# control (docs/hosting.md), never commit it, never share it with people who do not own the game.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT/work/Wiicompiled/build-web}"
STAGED_GAME="${STAGED_GAME:-$ROOT/work/sites/game}"
FILES=(WiiCompiled.html WiiCompiled.js WiiCompiled.wasm WiiCompiled.data mkw_disc.wasm mkw_disc_worker.js)

with_game=0; out=""; rooms_host=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-game) with_game=1; shift ;;
    --rooms-host) rooms_host="$2"; shift 2 ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) out="$1"; shift ;;
  esac
done
case "$rooms_host" in *://*|*/*|*\"*|*\|*) echo "--rooms-host takes a host name, not a URL: $rooms_host" >&2; exit 2 ;; esac
out="${out:-$ROOT/work/sites/release/public}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

for f in "${FILES[@]}"; do
  [ -f "$BUILD_DIR/$f" ] || { echo "missing $BUILD_DIR/$f: run scripts/build-private-bundle.sh first" >&2; exit 1; }
done
# A tracked path would commit game-derived files on the next `git add`.
if git -C "$out" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$out" check-ignore -q "$out"; then
  echo "refusing: $out is inside a git checkout and not ignored" >&2; exit 1
fi

for f in "${FILES[@]}"; do cp "$BUILD_DIR/$f" "$out/$f"; done
if [ -n "$rooms_host" ]; then
  # Emscripten minifies the page: the tag comes out as <meta content=... name=mkw-rooms-host>, in
  # either attribute order and with or without quotes.
  grep -qE '<meta[^>]*name="?mkw-rooms-host"?' "$out/WiiCompiled.html" ||
    { echo "this build's page has no mkw-rooms-host tag (older shell.html): rebuild the fork first" >&2; exit 1; }
  sed -E -i -e "s|(<meta[^>]*)content=\"?[^\"> ]*\"?([^>]*name=\"?mkw-rooms-host\"?[^>]*>)|\1content=\"$rooms_host\"\2|" \
            -e "s|(<meta[^>]*name=\"?mkw-rooms-host\"?[^>]*)content=\"?[^\"> ]*\"?([^>]*>)|\1content=\"$rooms_host\"\2|" "$out/WiiCompiled.html"
  grep -qE "<meta[^>]*content=\"$rooms_host\"[^>]*name=\"?mkw-rooms-host|<meta[^>]*name=\"?mkw-rooms-host\"?[^>]*content=\"$rooms_host\"" "$out/WiiCompiled.html" ||
    { echo "could not set the mkw-rooms-host tag in $out/WiiCompiled.html" >&2; exit 1; }
fi
(cd "$out" && sha256sum "${FILES[@]}" > SHA256SUMS)

if [ "$with_game" = 1 ]; then
  [ -f "$STAGED_GAME/manifest-v2.txt" ] || { echo "no staged game folder at $STAGED_GAME (run tools/hosting/stage-game.sh)" >&2; exit 1; }
  if [ -e "$out/game" ] && [ ! -L "$out/game" ]; then echo "refusing to replace non-symlink $out/game" >&2; exit 1; fi
  ln -sfn "$STAGED_GAME" "$out/game"
else
  [ -L "$out/game" ] && rm "$out/game"
fi

echo "Staged in $out:"
(cd "$out" && stat -c '  %10s  %n' "${FILES[@]}")
if [ -L "$out/game" ]; then echo "  game -> $(readlink "$out/game")  (fetch mode: the page streams the extracted disc)"
elif [ -f "$out/game/manifest-v2.txt" ]; then echo "  game/ staged in place (fetch mode: the page streams the extracted disc)"
else echo "  no game folder: players pick their own disc image in the page"; fi
if [ -n "$rooms_host" ]; then echo "  online play through https://$rooms_host (page tag mkw-rooms-host)"; fi
echo "Checksums in $out/SHA256SUMS. Serve it: see docs/hosting.md."
