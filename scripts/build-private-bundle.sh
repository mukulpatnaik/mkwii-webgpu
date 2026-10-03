#!/usr/bin/env bash
# Build the private browser bundle of Mario Kart Wii from YOUR OWN clean retail dump (PAL RMCP01,
# or NTSC-U/J/K through the region-support branch merged into work/Wiicompiled),
# on Linux, using Minithena's `web` branch of WiiCompiled (work/Wiicompiled, branch athena-web)
# and Minithena's page tooling (work/mariokartwebtest, with `wiicompiled` symlinked to our fork).
#
# Everything this script produces is derived from the game and lives in gitignored paths
# (work/Wiicompiled/Assets, work/Wiicompiled/generated, work/Wiicompiled/build-web,
# work/mariokartwebtest/site). Never commit, upload or share any of it.
#
# Usage:
#   scripts/build-private-bundle.sh /path/to/RMCP01.{iso,wbfs,rvz,gcm,ciso,gcz}
#   scripts/build-private-bundle.sh --skip-extract      # reuse Assets/DATA from an earlier run
#   scripts/build-private-bundle.sh --skip-translate    # reuse generated/ (runtime-only changes)
# Then:
#   cd work/mariokartwebtest && python3 tools/serve.py site/public
#   open http://127.0.0.1:8000/WiiCompiled.html?muted   (Chrome/Edge 137+ with WebGPU)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORK="$ROOT/work/Wiicompiled"
TOOLING="$ROOT/work/mariokartwebtest"
EMSDK="${EMSDK:-$HOME/tools/emsdk}"
DOTNET_ROOT="${DOTNET_ROOT:-$HOME/tools/dotnet}"
NODTOOL="${NODTOOL:-$HOME/tools/bin/nodtool}"
export DOTNET_ROOT DOTNET_CLI_TELEMETRY_OPTOUT=1
export PATH="$HOME/tools/bin:$DOTNET_ROOT:$PATH"
JOBS="${JOBS:-$(nproc)}"

skip_extract=0; skip_translate=0; dump=""
for arg in "$@"; do
  case "$arg" in
    --skip-extract) skip_extract=1 ;;
    --skip-translate) skip_translate=1 ;;
    *) dump="$arg" ;;
  esac
done

cd "$FORK"
[ -f runtime/src/platform/web/mkw_fibers.js ] || { echo "work/Wiicompiled is not on the web branch" >&2; exit 1; }

# 1. Extract the data partition (whole: the runtime reads an extracted DATA/ tree).
if [ "$skip_extract" = 0 ]; then
  [ -n "$dump" ] && [ -f "$dump" ] || { echo "give the path to your RMCP01 dump" >&2; exit 1; }
  "$NODTOOL" info "$dump" | sed -n 1,12p
  "$NODTOOL" info "$dump" | grep -qE "RMC[PEJK]01" || { echo "not a retail Mario Kart Wii disc" >&2; exit 1; }
  rm -rf Assets/DATA Assets/main.dol Assets/StaticR.rel
  mkdir -p Assets/DATA
  tmp="$(mktemp -d "$ROOT/game/extract.XXXXXX")"
  "$NODTOOL" extract "$dump" "$tmp" -q
  part="$(find "$tmp" -maxdepth 2 -name sys -type d | head -1 | xargs dirname)"
  cp "$part/sys/main.dol" Assets/main.dol
  cp "$part/files/rel/StaticR.rel" Assets/StaticR.rel
  mv "$part/files" Assets/DATA/files
  mv "$part/sys" Assets/DATA/sys
  rm -rf "$tmp"
  echo "main.dol    sha256 $(sha256sum Assets/main.dol | cut -c1-64)"
  echo "StaticR.rel sha256 $(sha256sum Assets/StaticR.rel | cut -c1-64)"
fi
[ -f Assets/DATA/sys/fst.bin ] || { echo "Assets/DATA is missing; run without --skip-extract" >&2; exit 1; }

# 1b. Pick the translation project from the disc's game ID (boot.bin starts with it).
GAME_ID="$(head -c 6 Assets/DATA/sys/boot.bin)"
case "$GAME_ID" in
  RMCP01) PROJECT=projects/mkwii/recomp.yml ;;
  RMCE01) PROJECT=projects/mkwii-ntsc-u/recomp.yml ;;
  RMCJ01) PROJECT=projects/mkwii-ntsc-j/recomp.yml ;;
  RMCK01) PROJECT=projects/mkwii-ntsc-k/recomp.yml ;;
  *) echo "unsupported game id '$GAME_ID'" >&2; exit 1 ;;
esac
[ -f "$PROJECT" ] || { echo "$PROJECT is missing: this checkout lacks region support for $GAME_ID" >&2; exit 1; }
REGION="$(sed -n 's/^  region: *\([A-Z]\).*/\1/p' "$PROJECT" | head -1)"
echo "game id $GAME_ID -> $PROJECT (region $REGION)"

# 2. Translate (same output as the native build; the translator pins the DOL/REL hashes).
translator() { dotnet "$FORK/translator/src/Translator.Cli/bin/Release/net8.0/Translator.Cli.dll" "$@"; }
if [ "$skip_translate" = 0 ]; then
  dotnet build translator/src/Translator.Cli/Translator.Cli.csproj -c Release -nologo -v q
  mkdir -p generated/functions build/base generated/build_shards
  translator translate-recursive 0x800060A4 \
    --project "$PROJECT" \
    --outdir generated/functions \
    --output-metadata generated/base_translation_output.json \
    --production-source-bundle generated/base_translation_sources.bin \
    --no-function-files --prune-stale --threads "$JOBS"
  translator emit-base-manifest \
    --project "$PROJECT" --out build/base \
    --functions-dir generated/functions \
    --translation-output-metadata generated/base_translation_output.json --region "$REGION"
  translator generate-data-init --project "$PROJECT"
  translator emit-build-shards \
    --project "$PROJECT" \
    --base-metadata generated/base_translation_output.json \
    --base-functions-dir generated/functions \
    --native-source-dir runtime/src \
    --out generated/build_shards
fi
[ -f generated/build_shards/shards.cmake ] || { echo "generated/build_shards/shards.cmake missing" >&2; exit 1; }

# 3. Web build (Emscripten). Products ON pulls in the translated shards.
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null
emcmake cmake -S runtime -B build-web -G Ninja -DCMAKE_MAKE_PROGRAM="$(command -v ninja)" \
  -DCMAKE_BUILD_TYPE=Release -DMKW_BUILD_PRODUCTS=ON
cmake --build build-web --target WiiCompiled --parallel "$JOBS"
ls -la build-web/WiiCompiled.wasm build-web/WiiCompiled.js build-web/WiiCompiled.html build-web/WiiCompiled.data 2>/dev/null || true

# 4. Stage for the local page (Minithena's tooling; symlinks the extracted disc, writes manifests).
cd "$TOOLING"
./tools/stage-web.sh
echo
echo "Staged. Serve with:  cd $TOOLING && python3 tools/serve.py site/public"
echo "Then open http://127.0.0.1:8000/WiiCompiled.html?muted in Chrome/Edge 137+."
