#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Stage a game folder for the page's fetch mode: the host streams the owner's extracted disc
# instead of asking each player for a disc image. Writes, in GAME_DIR:
#
#   DATA            -> symlink to the extracted disc ($FORK/Assets/DATA, written by nodtool)
#   save/rksys.dat     a copy of your save (optional): the page seeds its NAND from it once
#   file-packs/        one content-addressed pack of every disc file up to 64 KiB (one download
#                      instead of a hundred small ones)
#   manifest.txt       `d <dir>` and `f <size> <path>` lines: every file the page may read
#   manifest-v2.txt    the same plus `p [path, pack, offset, size]` lines for the packed files
#
#   tools/hosting/stage-game.sh [--fork DIR] [--save FILE|none] [GAME_DIR]
#
#   GAME_DIR   where to stage                   (default work/sites/game)
#   --fork     the WiiCompiled checkout whose Assets/DATA is the disc (default work/Wiicompiled)
#   --save     an rksys.dat to copy; default: the native Linux save of the disc's region under
#              ${XDG_DATA_HOME:-~/.local/share}/WiiCompiled, if there is one; `none` stages none
#
# Everything here is the owner's disc: gitignored, never committed, served only behind access
# control (docs/hosting.md). Link it into a release folder with stage-release.sh --with-game.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fork="$ROOT/work/Wiicompiled"; save=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fork) fork="$2"; shift 2 ;;
    --save) save="$2"; shift 2 ;;
    -h|--help) sed -n 3,20p "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) out="$1"; shift ;;
  esac
done
out="${out:-$ROOT/work/sites/game}"
data="$fork/Assets/DATA"
[ -f "$data/sys/boot.bin" ] && [ -f "$data/sys/fst.bin" ] || { echo "no extracted disc at $data (scripts/build-private-bundle.sh extracts it)" >&2; exit 1; }
data="$(cd "$data" && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
if git -C "$out" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$out" check-ignore -q "$out"; then
  echo "refusing: $out is inside a git checkout and not ignored" >&2; exit 1
fi

game_id="$(head -c 6 "$data/sys/boot.bin")"
title="$(head -c 4 "$data/sys/boot.bin" | od -An -tx1 | tr -d ' \n')"   # RMCE -> 524d4345
if [ -e "$out/DATA" ] && [ ! -L "$out/DATA" ]; then echo "refusing to replace the non-symlink $out/DATA" >&2; exit 1; fi
ln -sfn "$data" "$out/DATA"

# The save: yours as it is (licences, ghosts, unlocks), copied so the browser starts from it.
rm -rf "$out/save"
if [ "$save" = none ]; then
  save=""
elif [ -z "$save" ]; then
  candidate="${XDG_DATA_HOME:-$HOME/.local/share}/WiiCompiled/NAND/title/00010004/$title/data/rksys.dat"
  [ -f "$candidate" ] && save="$candidate"
fi
if [ -n "$save" ]; then
  [ -f "$save" ] || { echo "no such save: $save" >&2; exit 1; }
  [ "$(head -c 4 "$save")" = RKSD ] || { echo "$save is not an rksys.dat save (no RKSD header)" >&2; exit 1; }
  mkdir -p "$out/save"
  cp "$save" "$out/save/rksys.dat"
fi

python3 - "$out" <<'PY'
import hashlib, json, os, sys
out = sys.argv[1]
PACK_FILE_LIMIT, PACK_LIMIT = 64 * 1024, 16 * 1024 * 1024

def walk(top, prefix):
    """('d'/'f', logical path, size) for a tree, directories before their files, sorted."""
    for root, dirs, names in os.walk(os.path.join(out, top), followlinks=True):
        dirs.sort()
        rel = os.path.relpath(root, out).replace(os.sep, '/')
        yield 'd', rel, 0
        for name in sorted(names):
            yield 'f', rel + '/' + name, os.path.getsize(os.path.join(root, name))

entries = list(walk('DATA', 'DATA'))
if os.path.isdir(os.path.join(out, 'save')):
    entries += list(walk('save', 'save'))
lines = ['d ' + p if kind == 'd' else 'f %d %s' % (size, p) for kind, p, size in entries]

# Small disc files share one immutable pack; the save is excluded (it is per player).
small = [(p, size) for kind, p, size in entries if kind == 'f' and p.startswith('DATA/') and 0 < size <= PACK_FILE_LIMIT]
packed = []
if small:
    payload, index = bytearray(), []
    for p, size in small:
        with open(os.path.join(out, p), 'rb') as f:
            data = f.read()
        index.append((p, len(payload), len(data)))
        payload += data
    if len(payload) > PACK_LIMIT:
        sys.exit('the small-file pack would be %d bytes, over the page\'s %d limit' % (len(payload), PACK_LIMIT))
    name = 'file-packs/%s.bin' % hashlib.sha256(payload).hexdigest()
    os.makedirs(os.path.join(out, 'file-packs'), exist_ok=True)
    target = os.path.join(out, name)
    if not os.path.exists(target):
        with open(target + '.tmp', 'wb') as f:
            f.write(payload)
        os.replace(target + '.tmp', target)
    for stale in os.listdir(os.path.join(out, 'file-packs')):
        if 'file-packs/' + stale != name:
            os.remove(os.path.join(out, 'file-packs', stale))
    packed = ['p ' + json.dumps([p, name, offset, size]) for p, offset, size in index]

with open(os.path.join(out, 'manifest.txt'), 'w') as f:
    f.write('\n'.join(lines) + '\n')
with open(os.path.join(out, 'manifest-v2.txt'), 'w') as f:
    f.write('\n'.join(lines + packed) + '\n')
files = sum(1 for kind, _, _ in entries if kind == 'f')
print('%d files listed, %d of them in one %.1f MB pack' % (files, len(packed), len(payload) / 1e6 if small else 0))
PY

echo "Staged $game_id in $out (DATA -> $data$( [ -n "$save" ] && echo "; save from $save" ))."
echo "Next: tools/hosting/stage-release.sh --with-game  (links this folder into the release folder)"
