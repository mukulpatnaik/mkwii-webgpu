# Spike: WiiCompiled lean runtime on wasm32

Compiles the WiiCompiled runtime pieces the translator's own C++ tests link ("lean runtime":
`abi_bridge.cpp`, `fpu_helpers.cpp`, `memory.cpp`, `ppc_helpers.cpp`) plus the WiicompiledWeb
fork's wasm32 checked guest-memory backend, with Emscripten, and runs a semantic harness in Node.

Result on 2026-10-02 (Emscripten 6.0.11, fork `e1e4ba0c`): 216 KB `.wasm`, harness prints `ok`,
all 14 checks pass (fsel/ps_sel NaN and signed-zero semantics, exact fused paired madd, MEM1 alias
round trip, big-endian byte order, MMIO read reaches policy and throws).

```bash
source ~/tools/emsdk/emsdk_env.sh
./build.sh
```

Spike-only shortcuts, documented in `build.sh` and `wasm_isa_shim.h`:

- `-D__x86_64__ -msimd128 -mavx` compiles the x86 paired-single/PSQ code through Emscripten's SSE
  compatibility headers. Only `_mm_fmadd_ps`, `_mm_fmsub_ps` and `_mm_setcsr` were missing; the
  shim provides them (per-lane `std::fma`, no-op MXCSR). The production port needs a real
  `__wasm__` branch in `runtime/include/isa/*.h`.
- `RuntimeConfig.h` is a fake of the translator-generated header (SDA bases only).
- `translator_test_support.cpp` is the upstream test-support template with stubs for symbols the
  fork's older headers do not declare.

Files from WiiCompiled are GPLv3; this directory is GPLv3 as well.
