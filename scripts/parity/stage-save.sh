#!/usr/bin/env bash
# Stage a native save (rksys.dat: licences and ghosts) into a track's web site: copied to
# $SITE_DIR/game/save/rksys.dat and listed in the game manifests so the page can read it. The
# page seeds its NAND from it on first start, or again with ?resetsave.
#
#   eval "$(scripts/new-track.sh e)"
#   scripts/parity/stage-save.sh [path/to/rksys.dat]
#
# Without an argument the native save is looked up where the Linux product keeps it, for the
# region of the disc in $FORK/Assets (NTSC-U RMCE01 -> title/00010004/524d4345):
#   1. $NATIVE_BUILD/UserData/NAND/...            portable layout (a portable.txt next to, or up to
#                                                 four levels above, the executable)
#   2. ${XDG_DATA_HOME:-~/.local/share}/WiiCompiled/NAND/...   the default on Linux
#
# The save is copied as it is (the native file is not touched); the game folder is restaged by
# tools/hosting/stage-game.sh. The web build seeds the save into its own region's title directory
# (web_platform.cpp). The staged files are game-derived and gitignored: never commit them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${FORK:?run eval \"\$(scripts/new-track.sh <track>)\" first}"
: "${SITE_DIR:?}"
NATIVE_BUILD="${NATIVE_BUILD:-$FORK/build-native}"

boot="$FORK/Assets/DATA/sys/boot.bin"
[ -f "$boot" ] || { echo "no extracted disc at $FORK/Assets/DATA" >&2; exit 1; }
game_id="$(head -c 6 "$boot")"
title="$(head -c 4 "$boot" | od -An -tx1 | tr -d ' \n')"   # e.g. RMCE -> 524d4345
rel="NAND/title/00010004/$title/data/rksys.dat"

save="${1:-}"
if [ -z "$save" ]; then
  for candidate in "$NATIVE_BUILD/UserData/$rel" "${XDG_DATA_HOME:-$HOME/.local/share}/WiiCompiled/$rel"; do
    if [ -f "$candidate" ]; then save="$candidate"; break; fi
  done
fi
[ -n "$save" ] && [ -f "$save" ] || {
  echo "no native $game_id save found; looked for $NATIVE_BUILD/UserData/$rel and ${XDG_DATA_HOME:-$HOME/.local/share}/WiiCompiled/$rel" >&2
  exit 1
}
[ "$(head -c 4 "$save")" = RKSD ] || { echo "$save is not an rksys.dat save" >&2; exit 1; }
echo "disc $game_id; native save: $save"

"$ROOT/tools/hosting/stage-game.sh" --fork "$FORK" --save "$save" "$SITE_DIR/game"

staged="$SITE_DIR/game/save/rksys.dat"
[ -f "$staged" ] || { echo "stage-game.sh did not stage the save" >&2; exit 1; }
grep -q '^f [0-9]* save/rksys.dat$' "$SITE_DIR/game/manifest-v2.txt" || {
  echo "the save is missing from $SITE_DIR/game/manifest-v2.txt" >&2; exit 1; }
echo "staged $staged (a copy; the native save is untouched)"
echo "ghosts in the staged save:"
python3 "$ROOT/scripts/parity/rkg-info.py" "$staged"
