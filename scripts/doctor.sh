#!/usr/bin/env bash
# Check the toolchain this project needs against scripts/versions.env, and report the state of
# the checkouts and of the private, game-derived files (reported only; never copied anywhere).
#
#   scripts/doctor.sh            # exit 1 only when a required tool is missing
#   scripts/doctor.sh --quiet    # only problems
#
# A newer version than the pinned one is a warning, not an error: the pins record what the
# release was tested with (docs/release-checklist.md), not a maximum.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/versions.env
source "$ROOT/scripts/versions.env"
export PATH="$HOME/tools/bin:$DOTNET_DIR:$PATH"

quiet=0; [ "${1:-}" = "--quiet" ] && quiet=1
errors=0; warnings=0
ok()   { [ "$quiet" = 1 ] || printf '  ok    %s\n' "$*"; }
warn() { warnings=$((warnings + 1)); printf '  WARN  %s\n' "$*"; }
fail() { errors=$((errors + 1)); printf '  FAIL  %s\n' "$*"; }
note() { [ "$quiet" = 1 ] || printf '  --    %s\n' "$*"; }
section() { [ "$quiet" = 1 ] || printf '\n%s\n' "$*"; }

# vercmp a b: 0 if a == b, 1 if a > b, 2 if a < b (dotted numeric prefixes only).
vercmp() {
  local a="${1%%[^0-9.]*}" b="${2%%[^0-9.]*}" i x y
  IFS=. read -r -a x <<< "$a"; IFS=. read -r -a y <<< "$b"
  for i in 0 1 2; do
    [ "${x[$i]:-0}" -gt "${y[$i]:-0}" ] && return 1
    [ "${x[$i]:-0}" -lt "${y[$i]:-0}" ] && return 2
  done
  return 0
}

# tool <name> <required|optional> <version found> <pinned> [what for]
tool() {
  local name="$1" need="$2" found="$3" pinned="$4" what="${5:-}"
  if [ -z "$found" ]; then
    if [ "$need" = required ]; then fail "$name: not found${what:+ ($what)}"; else warn "$name: not found${what:+ ($what)}"; fi
    return
  fi
  vercmp "$found" "$pinned"
  case $? in
    0) ok "$name $found" ;;
    1) warn "$name $found is newer than the pinned $pinned${what:+ ($what)}" ;;
    2) if [ "$need" = required ]; then fail "$name $found is older than the pinned $pinned${what:+ ($what)}"; else warn "$name $found is older than the pinned $pinned${what:+ ($what)}"; fi ;;
  esac
}
version_of() { command -v "$1" >/dev/null 2>&1 && "$@" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1; }

section "Toolchain (pins in scripts/versions.env)"
if [ -f "$EMSDK_DIR/upstream/emscripten/emscripten-version.txt" ]; then
  tool emscripten required "$(tr -d '"' < "$EMSDK_DIR/upstream/emscripten/emscripten-version.txt")" "$EMSDK_VERSION" "source $EMSDK_DIR/emsdk_env.sh"
else
  fail "emscripten: $EMSDK_DIR has no upstream/emscripten (set EMSDK or install emsdk $EMSDK_VERSION there)"
fi
tool dotnet required "$(version_of dotnet --version)" "$DOTNET_VERSION" "translator; DOTNET_ROOT=$DOTNET_DIR"
tool node required "$(version_of node --version)" "$NODE_VERSION" "Node $NODE_MAJOR"
tool "clang-$CLANG_MAJOR" required "$(version_of "clang-$CLANG_MAJOR" --version)" "$CLANG_VERSION" "native build"
tool cmake required "$(version_of cmake --version)" "$CMAKE_VERSION"
tool ninja required "$(version_of ninja --version)" "$NINJA_VERSION"
tool cargo required "$(version_of cargo --version)" "$RUST_VERSION" "disc reader"
if command -v rustup >/dev/null 2>&1; then
  if rustup target list --installed 2>/dev/null | grep -qx "$RUST_WASM_TARGET"; then ok "rust target $RUST_WASM_TARGET"
  else fail "rust target $RUST_WASM_TARGET missing: rustup target add $RUST_WASM_TARGET"; fi
else
  warn "rustup not found; cannot check the $RUST_WASM_TARGET target"
fi
tool nodtool required "$(version_of nodtool --version)" "$NODTOOL_VERSION" "disc extraction, ~/tools/bin/nodtool"
tool python3 required "$(version_of python3 --version)" "$PYTHON_VERSION"
tool bun optional "$(version_of bun --version)" "$BUN_VERSION" "tools/web-server"
chrome=""
for b in google-chrome google-chrome-stable chromium microsoft-edge; do
  if command -v "$b" >/dev/null 2>&1; then chrome="$(version_of "$b" --version)"; break; fi
done
if [ -z "$chrome" ]; then warn "no Chrome/Edge/Chromium found (browser tests need Chrome $CHROME_MIN+)"
else vercmp "$chrome" "$CHROME_MIN"; if [ $? = 2 ]; then warn "Chrome $chrome is older than $CHROME_MIN (JSPI, WebGPU)"; else ok "Chrome $chrome"; fi; fi

section "Paths"
case ":$PATH:" in
  *":$HOME/tools/bin:"*) ok "\$HOME/tools/bin is on PATH" ;;
  *) warn "\$HOME/tools/bin is not on PATH (put it first: export PATH=\$HOME/tools/bin:\$PATH)" ;;
esac
if [ -x "$HOME/.local/bin/ninja" ] && [ "$(command -v ninja)" = "$HOME/.local/bin/ninja" ]; then
  warn "ninja resolves to \$HOME/.local/bin/ninja, the broken shim; \$HOME/tools/bin must come first"
fi
if [ -d "$DOTNET_DIR" ]; then ok "dotnet root $DOTNET_DIR"; else warn "dotnet root $DOTNET_DIR missing"; fi
if [ -n "${DISPLAY:-}" ]; then ok "DISPLAY=$DISPLAY"; else warn "DISPLAY is not set (browser tests drive Chrome on an X display; see tools/browser-test/README.md)"; fi

section "Checkouts"
fork="$ROOT/work/Wiicompiled"
if [ -d "$fork/.git" ]; then
  branch="$(git -C "$fork" branch --show-current 2>/dev/null)"
  if [ "$branch" = athena-web-ntsc ]; then ok "work/Wiicompiled on athena-web-ntsc"; else warn "work/Wiicompiled is on '$branch', not athena-web-ntsc"; fi
  [ -f "$fork/runtime/src/platform/web/mkw_fibers.js" ] || warn "work/Wiicompiled is not a web branch (no runtime/src/platform/web/mkw_fibers.js)"
else
  fail "work/Wiicompiled missing: git clone -b athena-web-ntsc https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled.git work/Wiicompiled"
fi
if [ -d "$ROOT/upstream/nod" ]; then ok "upstream/nod present (spikes/disc-wasm)"; else note "upstream/ not cloned (scripts/clone-upstream.sh; only needed for the spikes and research)"; fi
if [ -d "$ROOT/tools/browser-test/node_modules/playwright-core" ]; then ok "tools/browser-test dependencies installed"; else note "tools/browser-test: run npm install there before browser tests"; fi

section "Private, game-derived data (reported only; never commit or upload any of it)"
discs=("$ROOT"/game/*.wbfs "$ROOT"/game/*.iso "$ROOT"/game/*.ciso "$ROOT"/game/*.rvz "$ROOT"/game/*.gcm)
found_disc=0; for d in "${discs[@]}"; do [ -f "$d" ] && found_disc=1; done
if [ "$found_disc" = 1 ]; then ok "a disc image is in game/"; else note "no disc image in game/ (scripts/build-private-bundle.sh needs one for extraction)"; fi
if [ -f "$fork/Assets/DATA/sys/boot.bin" ]; then ok "work/Wiicompiled/Assets/DATA extracted ($(head -c 6 "$fork/Assets/DATA/sys/boot.bin"))"; else note "work/Wiicompiled/Assets/DATA not extracted"; fi
if [ -f "$fork/generated/build_shards/shards.cmake" ]; then ok "work/Wiicompiled/generated translated"; else note "work/Wiicompiled/generated not translated"; fi
if [ -f "$fork/build-web/WiiCompiled.wasm" ]; then ok "work/Wiicompiled/build-web built ($(date -r "$fork/build-web/WiiCompiled.wasm" +%F))"; else note "work/Wiicompiled/build-web not built"; fi
if [ -f "$fork/build-web/mkw_disc.wasm" ]; then ok "disc reader built (mkw_disc.wasm)"; else note "disc reader not in build-web (players cannot pick a disc without it)"; fi

printf '\n%d problem(s), %d warning(s)\n' "$errors" "$warnings"
[ "$errors" = 0 ]
