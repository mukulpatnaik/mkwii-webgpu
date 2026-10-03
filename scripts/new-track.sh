#!/usr/bin/env bash
# Create (or describe) a parallel work track: a git worktree of work/Wiicompiled with its own
# branch, build directory, staged site and port, so several tracks can build and test at once.
#
#   scripts/new-track.sh <name>          # e.g. scripts/new-track.sh a
#
# Creates work/wt-<name> on branch track/<name> from athena-web-ntsc (override with BASE=...),
# symlinks the gitignored, game-derived Assets/ and generated/ (and build/base) from the main
# checkout (they are identical for every track, so tracks must not re-extract or re-translate),
# and writes work/sites/<name>/track.env. Running it again for an existing track only prints
# the environment. Use it like:
#
#   eval "$(scripts/new-track.sh a)"
#   scripts/build-private-bundle.sh --skip-extract --skip-translate
#   python3 work/mariokartwebtest/tools/serve.py "$SITE_DIR" --port "$PORT"
set -euo pipefail

name="${1:-}"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "usage: $0 <name>  (lowercase letters, digits, -)" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$ROOT/work/Wiicompiled"
WT="$ROOT/work/wt-$name"
SITE="$ROOT/work/sites/$name"
BASE="${BASE:-athena-web-ntsc}"
env_file="$SITE/track.env"

if [ ! -f "$env_file" ]; then
  [ -d "$MAIN/generated/build_shards" ] && [ -f "$MAIN/Assets/DATA/sys/fst.bin" ] || {
    echo "the main checkout has no Assets/DATA or generated/; run scripts/build-private-bundle.sh first" >&2
    exit 1
  }
  if [ ! -d "$WT" ]; then
    git -C "$MAIN" worktree add -q -b "track/$name" "$WT" "$BASE" >&2
  fi
  ln -sfn "$MAIN/Assets" "$WT/Assets"
  ln -sfn "$MAIN/generated" "$WT/generated"
  if [ -d "$MAIN/build/base" ]; then
    mkdir -p "$WT/build"
    ln -sfn "$MAIN/build/base" "$WT/build/base"
  fi
  # The fork's .gitignore matches /Assets/ and /generated/ as directories only; symlinks need
  # their own patterns. info/exclude is shared by all worktrees.
  exclude="$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  for pattern in /Assets /generated; do
    grep -qxF "$pattern" "$exclude" 2>/dev/null || echo "$pattern" >> "$exclude"
  done

  # First port from 8001 that no other track has claimed (the main checkout uses 8000).
  port=8001
  while grep -qxs "export PORT=$port" "$ROOT"/work/sites/*/track.env; do port=$((port + 1)); done

  mkdir -p "$SITE/public"
  cat > "$env_file" <<EOF
export FORK=$WT
export BUILD_DIR=$WT/build-web
export SITE_DIR=$SITE/public
export PORT=$port
EOF
fi

cat "$env_file"
