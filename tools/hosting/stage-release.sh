#!/usr/bin/env bash
# Stage a release folder: the six page files the browser build produces, and nothing from the
# disc. Players pick their own disc image in the page. With --with-game the folder also serves
# the owner's staged game folder (fetch mode), for a host that should stream the extracted disc.
#
#   tools/hosting/stage-release.sh [--with-game] [OUT]
#
#   OUT          folder to serve                 (default work/sites/release/public)
#   BUILD_DIR    the Emscripten build to take the files from (default work/Wiicompiled/build-web)
#   STAGED_GAME  the staged game folder for --with-game
#                (default work/mariokartwebtest/site/public/game, written by tools/stage-web.sh)
#
# The .wasm contains translated game code: the folder is private. Host it only behind access
# control (docs/hosting.md), never commit it, never share it with people who do not own the game.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT/work/Wiicompiled/build-web}"
STAGED_GAME="${STAGED_GAME:-$ROOT/work/mariokartwebtest/site/public/game}"
FILES=(WiiCompiled.html WiiCompiled.js WiiCompiled.wasm WiiCompiled.data mkw_disc.wasm mkw_disc_worker.js)

with_game=0; out=""
for arg in "$@"; do
  case "$arg" in
    --with-game) with_game=1 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    -*) echo "unknown option $arg" >&2; exit 2 ;;
    *) out="$arg" ;;
  esac
done
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
(cd "$out" && sha256sum "${FILES[@]}" > SHA256SUMS)

if [ "$with_game" = 1 ]; then
  [ -f "$STAGED_GAME/manifest-v2.txt" ] || { echo "no staged game folder at $STAGED_GAME (run tools/stage-web.sh in work/mariokartwebtest)" >&2; exit 1; }
  if [ -e "$out/game" ] && [ ! -L "$out/game" ]; then echo "refusing to replace non-symlink $out/game" >&2; exit 1; fi
  ln -sfn "$STAGED_GAME" "$out/game"
else
  [ -L "$out/game" ] && rm "$out/game"
fi

echo "Staged in $out:"
(cd "$out" && stat -c '  %10s  %n' "${FILES[@]}")
if [ -L "$out/game" ]; then echo "  game -> $(readlink "$out/game")  (fetch mode: the page streams the extracted disc)"
else echo "  no game folder: players pick their own disc image in the page"; fi
echo "Checksums in $out/SHA256SUMS. Serve it: see docs/hosting.md."
