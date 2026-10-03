#!/usr/bin/env bash
# Spike: compile WiiCompiled's lean runtime (ABI bridge, FP/PSQ helpers, checked guest
# memory) to wasm32 with Emscripten and run the FP-semantics + memory harness in Node.
#
# Requires:
#   - emsdk activated (source ~/tools/emsdk/emsdk_env.sh)  -- verified with 6.0.11
#   - upstream/wiicompiledweb checkout (OtherShindo957/WiicompiledWeb @ e1e4ba0c):
#     it carries the MKW_CHECKED_GUEST_MEMORY headers and runtime/src/platform/web/*.
#
# Deliberate spike hacks (NOT the production approach, see docs/research-browser-port.md):
#   -D__x86_64__ -msimd128 -mavx : use Emscripten's SSE/AVX compat layer for the x86 paths
#                                   in runtime/include/isa/*.h
#   wasm_isa_shim.h              : supplies _mm_fmadd_ps/_mm_fmsub_ps (per-lane std::fma)
#                                   and a no-op _mm_setcsr
#   RuntimeConfig.h              : fake translator output (SDA bases)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
R="${WIICOMPILED_WEB_RUNTIME:-$ROOT/upstream/wiicompiledweb/runtime}"
OUT="$HERE/out"; mkdir -p "$OUT/generated"
cp "$HERE/RuntimeConfig.h" "$OUT/generated/RuntimeConfig.h"
SRCS=(
  "$R/src/abi_bridge.cpp" "$R/src/fpu_helpers.cpp" "$R/src/memory.cpp" "$R/src/ppc_helpers.cpp"
  "$R/src/platform/web/guest_memory.cpp" "$R/src/platform/web/memory_diagnostics.cpp"
)
time em++ -std=c++20 -O1 -msimd128 -mavx -D__x86_64__ -DMKW_CHECKED_GUEST_MEMORY=1 \
  -fno-fast-math -ffp-contract=off -fwasm-exceptions -sSUPPORT_LONGJMP=wasm \
  -include "$HERE/wasm_isa_shim.h" -I"$OUT" -I"$R/include" \
  "${SRCS[@]}" "$HERE/translator_test_support.cpp" "$HERE/harness.cpp" \
  -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 \
  -sSTACK_SIZE=4194304 -sERROR_ON_UNDEFINED_SYMBOLS=1 -o "$OUT/harness.cjs"
ls -la "$OUT/harness.wasm"
node "$OUT/harness.cjs" && echo && echo "PASS: all harness checks succeeded under wasm32"
