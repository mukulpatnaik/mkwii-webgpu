# Research: running Mario Kart Wii in the browser on WiiCompiled + Aurora

Date: 2026-10-02. Status: Milestone 0 complete, Milestone 1 partially retired by a spike.

This document records what was actually read, built and run in the first session, what other
people have already done, and how each browser incompatibility is classified:

```text
GREEN  = likely trivial / platform adapter
YELLOW = meaningful engineering but understood
RED    = may require architectural change
```

Companion documents: [docs/plan.md](plan.md) (critique of the original plan and the final plan)
and [docs/adr/0001-browser-architecture.md](adr/0001-browser-architecture.md).

## 1. Pinned sources

Cloned under `upstream/` (gitignored; `scripts/clone-upstream.sh` re-creates them).

| Repo | SHA | Date | Notes |
|---|---|---|---|
| patchzyy/Wiicompiled | `9d182f831618235b0cf74ab891b8c3440b658e30` | 2026-10-02 | GPLv3. No submodules; Aurora is vendored in-tree as `aurora-main/` |
| encounter/aurora (upstream) | `77997d4591df5196bd81e5cc758a430864111988` | 2026-10-03 | MIT. No Emscripten support in upstream |
| 999sian/melee-pc | `e83383539a4fd06e9bd8b28c270b3d1ecc7d3be3` | 2026-09-29 | Contains the merged browser platform and the Aurora Emscripten patch |
| OtherShindo957/WiicompiledWeb | `e1e4ba0c4de76f66ad9be11baf2b7d5e4ec9a282` | 2026-09-26 | WiiCompiled fork executing a browser-port plan nearly identical to ours |
| akratch/goldenballoon | `106bad37244a2f8829bab21c655d25ff4b4dcdbf` | 2026-09-11 | N64 kart racer that ships a browser build; patterns for shell, saves, pacing |
| **Minithena/Wiicompiled**, branch `web` | `40ff69a9a6d4d9e8ee78f3b34a352ceb5767aab1` | 2026-10-02 | **A working browser port of WiiCompiled** (43 commits over upstream `9b7b991`, 2026-09-30). Our working fork is based on this |
| **Minithena/mariokartwebtest** | `384cffac` | 2026-10-02 | Page tooling, Cloudflare Worker/R2 hosting, Durable Object room relay, benchmarks, handover notes. **Gone from GitHub (404) by 2026-10-28**, no DMCA notice found; our complete clones are `upstream/mariokartwebtest` (pristine), `work/mariokartwebtest` (with our commits) and the private backup `mukulpatnaik/mkwii-webgpu-webtest` |

WiiCompiled's vendored `aurora-main/` was imported at commit `ec226e8 init` (2026-08-23) and has 24
fork commits since. `patchzyy/aurora` on GitHub mirrors it (24 ahead, 191 behind upstream). It is a
real fork, not a snapshot: `diff -rq` against upstream gives 240 differing paths; the fork adds
`lib/gx/frame_interpolation.cpp` (1536 lines), EFB-to-RAM copies, a frame worker thread, a
presenter thread, present scheduling APIs, and removes upstream's newer `render_worker`, `thread`,
`input/` and RmlUi code.

Toolchains installed for this work: Emscripten 6.0.11 (`~/tools/emsdk`), .NET SDK 8.0.425
(`~/tools/dotnet`), clang-16 (system). The WiiCompiled translator builds and its default suite
passes: 641/641 tests.

## 2. Prior art (the most important finding)

The original plan assumed the Aurora browser backend had to be invented, and that the WiiCompiled port itself was open work. Both already exist; the first row below supersedes most of Milestones 1 to 7 of the original brief.

| Project | What it proves | Relevance |
|---|---|---|
| **Minithena/Wiicompiled `web` + Minithena/mariokartwebtest** (owner "Athena", Discord `hiemal`; found 2026-10-02 after the first draft of this document) | **Mario Kart Wii already runs in the browser on WiiCompiled.** Their notes (`CLAUDE.md`, `HANDOVER.md`) record: races run in Chrome 152 and Firefox 156; the native reference ghost (Mario Circuit 1:44.178) replays with an identical time, so physics parity holds in wasm; steady racing at 60 FPS with about 4.4 to 6.5 ms CPU per frame on an Apple M5; hosted privately on Cloudflare (Worker + R2, 108 to 122 MB wasm); private invite rooms over a Cloudflare Durable Object WebSocket relay carrying both the TCP WFC services and the peer UDP datagrams, two local clients matched into the same race. Design: guest threads are **JSPI coroutines** (`host_context.cpp` + `mkw_fibers.js`, about 3 µs per switch, each context owns a C stack and the JS swaps `__stack_pointer` and limits), `-sPROXY_TO_PTHREAD` with an 8-worker pool and `OFFSCREENCANVAS_SUPPORT`, `guest_flat_memory_wasm.cpp` on the checked page-table path (about 240 MB peak heap of 512 MB initial), WASMFS fetch backend with a rewritten JS half streaming the extracted disc over HTTP range requests from a manifest, OPFS for saves/config, Aurora on emdawnwebgpu with core-WGSL rewrites for Firefox, time-budgeted pipeline prewarm from 1,199 bundled recipes, event-driven present (MapAsync promise + MessageChannel yield, because nested timers clamp to 4 ms). Builds only on the owner's Mac. | This is Phases 1 and 2 of our plan, done. Open items in their handover that we can own: **M3 "players bring their own disc" (deferred by the owner)**, presentation tied to the display refresh (non-60 Hz judder), slower-hardware real-time simulation, a two-machine online test, Safari (`encoder state is not valid`), Linux/Windows build hosts. |
| **melee-pc PR #85** "Browser platform: Emscripten + WebGPU" (turtlesoupy, merged 2026-09-23, live at 999sian.github.io/melee-pc/play/, production fork powers smash.fun) | Aurora GX runs on browser WebGPU through emdawnwebgpu at a steady 60 fps. The Aurora change is one commit, `64b4642`, +329/-12 lines across 25 files, all under `__EMSCRIPTEN__`. Game code changes were 28 lines. | This is the Aurora recipe. It targets upstream Aurora (999sian's sync), not WiiCompiled's fork, so it must be re-applied to `aurora-main/`. |
| **vibepfrog/dusk-wasm** (Twilight Princess, Aurora via emdawnwebgpu) | Aurora + nod (Rust) build for `wasm32-unknown-emscripten`; moved from Asyncify to **pthreads + JSPI**; documents 14 concrete build breakages and fixes; documents emdawnwebgpu bind-group handle-lifetime bug and fix. | Second independent confirmation. Their `docs/pthread-spike.md` and `wasm-port-notes.md` are a checklist of Aurora-on-Emscripten pitfalls. |
| **OtherShindo957/WiicompiledWeb** (fork, branches `web/milestone-0-audit`, `web/milestone-2-guest-memory`) | A 150-line audit of WiiCompiled's portability, an architecture decision, a game-free Emscripten+WebGPU probe with Playwright tests and CI, and a tested **compact checked guest-memory backend for wasm32** (`runtime/src/platform/web/guest_memory.cpp`, `MKW_CHECKED_GUEST_MEMORY`). 3/3 wasm tests pass in Node; the same contracts pass natively under ASan/UBSan. | Someone is already doing our Milestones 0 to 2. Their conclusions match ours independently. We should build on this fork, not duplicate it. |
| **anasahmed08/mkwii-web** (archived) | A browser shell (disc readers for ISO/RVZ/WBFS, Retro Rewind staging, AudioWorklet, gamepad/gyro, IndexedDB saves, libco-to-fiber port notes) that never ran the game. Author's stated blockers: "emitter emits x86-specific constructs", "Aurora not at parity under wasm64", "Safari lacks memory64". | Two of the three blockers are wrong (see section 5): the x86 code is in runtime headers not the emitter, and memory64 is not needed. Useful as a list of browser-side UI pieces; not a basis to build on. |
| WiiCompiled issue #124 "[Feature] Web port" (closed) and #246 (closed by author) | No maintainer position recorded. A commenter (TheReal-Flo) claimed "web runtime is ready" on 2026-09-08; no public repo exists for it. | Upstream stance on a wasm target is unknown; must be asked before large PRs. |
| Platform ports of WiiCompiled: KartPad (iOS/Android/tvOS, Metal/Vulkan), driftdroid and wheeldroid (Android), wiicompiled-nx (Switch), mkwii-ps5, WiiCompiled-Xbox-UWP, Wiicompiled_VR, Strikers-WiiCompiled, DJH2Recomp, `origin/ios_experimental` branch upstream | The runtime has been re-platformed six-plus times; iOS proves an AOT, no-JIT target works. Upstream merged "Kartpad upstream fixes (#244)". | The platform seam is real, and upstream accepts platform-port fixes. |
| goldenballoon | A shipped N64 browser port: cooperative single thread, narrowed Asyncify spine, rAF-bounded presentation with interpolation at authored 30 Hz, IDBFS saves with Web Locks, service-worker versioning. | Patterns for pacing, saves and shell, not code. |

Related toolchain facts verified this session:

- `emdawnwebgpu` is Dawn's maintained `webgpu.h` implementation for Emscripten (`--use-port=emdawnwebgpu`); Emscripten's built-in `-sUSE_WEBGPU` is deprecated.
- JSPI (JavaScript Promise Integration) is shipped in Chrome 137+, default-on planned for Firefox 153, Safari 27 beta. It is a phase-4 proposal.
- Emscripten fibers (`emscripten_fiber_swap`) are implemented in Asyncify mode 1 only.

## 3. WiiCompiled architecture (as read from `9d182f8`)

### 3.1 Translator and output format

- .NET 8 solution in `translator/`. Pipeline: DOL/REL load → PowerPC decode → IR/SSA → type
  inference → C++ emission. Four CLI commands: `translate-recursive`, `generate-data-init`,
  `emit-build-shards`, then CMake+Ninja+Clang.
- **One `extern "C" void func_XXXXXXXX(CpuContext* ctx)` per guest function.** `CpuContext` is
  464 bytes of `uint32_t`/`double` fields only (`static_assert` at `abi_bridge.cpp:33`), so its
  layout is identical on 32- and 64-bit hosts.
- Control flow is `goto`/label based; jump tables become `switch`; LR-continuation dispatch
  creates irreducible CFGs (LLVM's wasm backend handles these with FixIrreducibleControlFlow).
- Direct calls are real host calls (`InvokeDirectCpu<addr>`, rewritten to direct symbol calls at
  shard time). Indirect calls go through a translator-emitted sorted table with one signature,
  `void(CpuContext*)`, so wasm `call_indirect` type checks are satisfied.
- **All memory access goes through inline helpers** (`MemoryInline::FlatRead32`, `FlatWrite32`,
  `FlatWriteRam32`, `FlatReadFloat32`, `ResolveRangeHost`+`ReadResolvedN`). Generated code never
  dereferences a raw host pointer. Byte swaps use `__builtin_bswap*`.
- Emitted text contains no intrinsics, inline asm, SEH, computed goto, `uintptr_t`, `setjmp`.
  Verified by grepping `translator/src` emitter strings.
- Data sections are embedded via a generated `.S` file using `.incbin` of the game's
  `.data/.rodata/.sdata` (`AssemblyBlobWriter.cs:51`). This means **the generated bundle contains
  raw Nintendo data as well as derived code** and can never be distributed.
- Scale: roughly 28k translated functions, aggregated into 72 base + 48 mod + 16 registration
  shards of several MB each ("hundreds of megabytes" of C++); the Ninja pool budgets about 2 GB
  RAM per translated TU. Translated code is built `-O2 -fno-fast-math -ffp-contract=off`; the
  runtime `-O3 -ffast-math`; no LTO.

### 3.2 Runtime

- `runtime/`: C++20, Clang only, 64-bit only (`CMakeLists.txt:4-19` hard-fails otherwise).
  Platforms: MinGW-clang x64, Linux x64/arm64, macOS arm64. Release-only.
- `main()` fills `AuroraConfig`, calls `aurora_initialize`, registers hooks, then
  `InvokeIndirectCpu(entry)` and never returns. **There is no host frame loop.**
- Platform abstraction is thin: `platform/host_platform.*` (paths), `HostContext` (context
  switching, 6 functions), `AudioBackend`, `GuestFlat` (memory backend). Everything else is
  `#if _WIN32/__APPLE__/__linux__` inline; heaviest files are `isa/ppc_isa_float.h` (41),
  `main.cpp` (21), `guest_flat_memory.cpp` (19), `isa/ppc_isa_quantized.h` (11).

### 3.3 Guest memory model

Two access paths exist in every build:

- **Flat path (default fast path).** `*(T*)(kFixedFlatGuestBase + addr)`. A 4 GiB host VA
  reservation at a fixed base (x86_64: 16 TiB; arm64 Linux/macOS: other constants), MEM1/MEM2
  mirrors created with `MAP_FIXED` views of a memfd, MMIO reads and EFB deferred reads and
  executable-page writes all intercepted by **page faults** (SIGSEGV / vectored exception
  handler). Unmapped 64 KiB blocks are committed on demand in the fault handler.
- **Checked path (page table).** 1 MiB pages, `g_pageTable[4096]`, bias tables encoded as
  `(hostPageBase - guestPageBase) + 1`, 4 KiB sub-pages for mixed pages. Enabled when
  `GuestFlat::RequiresCheckedAccess()` is true, which today is a runtime global set on 16 KiB-page
  macOS. Arithmetic is modulo 2^32 so it is correct with 32-bit `uintptr_t`.
- Exceptions: `FlatWriteRam*`, `FlatLoad`/`FlatStore`, `ResolveRangeHost` and the PSQ helpers
  dereference the fixed base unconditionally (`memory_access.h:540-551, 620-641`). This is why even
  macOS checked mode still reserves the window. The WiicompiledWeb fork gates these on
  `MKW_CHECKED_GUEST_MEMORY` (+16 lines) and adds `kFixedFlatGuestBase = 0` for that mode.
- Sizes: MEM1 24 MiB, MEM2 128 MiB (devkit size on purpose), Kamek overlay 2 MiB, locked cache
  1 MiB, about **155 MiB** of backing total. No separate ARAM/EFB store. Fits wasm32 easily.
- MMIO window `0xCC000000..0xCDFFFFFF`; GX FIFO `0xCC008000..0xCC0080FF` is routed to
  `GX_HLE_FIFO_Write*` on both paths; other MMIO throws `Memory::AccessViolation` on the checked
  path.
- No host pointers are stored in guest-visible memory; `lwarx/stwcx.` are emulated with a global
  reservation and plain loads/stores; no `std::atomic` on guest memory; all accesses `memcpy`
  (unaligned-safe).

### 3.4 Threads and fibers

- **Guest execution is strictly single-host-threaded and cooperative.** Each Wii `OSThread` is a
  host stackful coroutine: Win32 fibers, vendored libco (Linux), custom asm (macOS). Any other
  platform hits `#error` in `host_context.cpp:23`. Switching is symmetric (`co_switch`-style),
  happens only inside HLE (`SelectThread` in `os_scheduler.cpp`), and copies the single shared
  `CpuContext` in and out of the fiber.
- Host stacks: 1 MiB per fiber (`fiber_manager.cpp:264`), 4 to 6 fibers in normal play, about 10
  peak (sound thread, task threads, THP decode, DWC/NHTTP when online).
- Interrupts are **polled, never preemptive**: the scheduler idle loop pumps sleep timers,
  audio DMA, VI retrace and alarms, then **blocks the host thread** (`sleep_until`/spin) until the
  next retrace. Alarms are also pumped from `PPCMtdec`, `GX__Begin` (max once per ms) and
  `RFLiIsWorking`. The "VI timer thread" mentioned in `fiber_manager.h:27` no longer exists.
- Other host threads: Aurora frame worker, Aurora presenter (sleeps to interpolation deadlines),
  interpolation pool (up to 6), pipeline compile workers (already disabled for the WebGPU backend
  type), pipeline cache writer, optional AX mix worker (inline fallback exists), DNS workers,
  music-ducking monitor, stdio transcript pipes, Discord IPC.
- Present path: `GX__CopyDisp` → `VI_HLE_PresentFrame` → `aurora_end_frame()` →
  `PaceToRetraceBoundary` (blocks in 1 ms slices). Simulation runs at the VI cadence from wall
  clock; interpolation slots are time-sliced presents on the presenter thread. There is no
  "advance one frame" function; the two natural yield points are the idle-loop wait
  (`VI_HLE_WaitForNextRetracePoll`, `vi.cpp:456`) and `PaceToRetraceBoundary` (`vi.cpp:490`).
- `thread_local` appears in headers inlined into translated code (`g_currentCpuContext`, indirect
  dispatch memos, NI flush state). Without pthreads these compile to plain globals.
- C++ exceptions cross translated code on the checked path (`Memory::AccessViolation` thrown from
  `memory.cpp`, caught in HLE and `main.cpp`). `setjmp` is used only around fault recovery.

### 3.5 Floating point and SIMD

- `isa/ppc_isa_config.h` includes `<immintrin.h>` or `<arm_neon.h>`, else `#error`.
- `isa/ppc_isa_float.h`: `PpcPairVec` is `__m128` or `float32x2_t`; every paired-single op has
  only SSE or NEON paths, including `_mm_fmadd_ps/_mm_fmsub_ps` (FMA3) for exact single-rounding
  madd. `isa/ppc_isa_quantized.h` likewise (`_mm_shuffle_epi8` etc.).
- `isa/ppc_isa_fpenv.h`: FPSCR[NI] is mirrored into MXCSR FTZ|DAZ / FPCR.FZ on every
  `CpuContextScope`; `#error` elsewhere.
- Rounding is explicit (`static_cast<float>`, 25-bit force, software `fctiw`); no x87, no
  `<cfenv>`. NaN propagation is tuned to x86 semantics (`ppc_isa_float.h:529-536`); wasm NaN
  payloads are non-deterministic, so NaN-input edge cases may diverge.
- Core wasm has no scalar FMA; `std::fma` becomes a musl soft-float call. Relaxed-SIMD
  `relaxed_madd` is non-deterministic and unusable for exactness.

### 3.6 Graphics stack

`MKW GX calls → runtime/src/hle/gx/* (about 135 GX* functions) → aurora-main GX → WebGPU (Dawn)`.
The runtime never calls Dawn directly. It uses fork-only Aurora APIs: frame worker wait callback,
present schedule, producer pacing, interpolation fps, skip-unready pipelines, guest write hooks,
EFB flush to RAM. Backend table in `main.cpp:1386-1400` is per-OS; no WebGPU entry.

### 3.7 Audio, input, disc, NAND, network

- **Audio:** push model from the guest thread into an SDL3 audio stream
  (`SDL_OpenAudioDeviceStream`, `SDL_PutAudioStreamData`), 32 kHz or 48 kHz stereo S16, 120 ms
  cap. AX mix optionally on a worker thread with an inline fallback. Music ducking is Windows/Linux
  OS-specific and droppable.
- **Input:** `PAD__Read_HLE` → Aurora `PADRead()` → SDL3 `SDL_Gamepad`; Dolphin-syntax
  expression bindings applied on top. Wii Remote via SDL3 HIDAPI; no IR pointer. **A GameCube pad
  mapping is sufficient for menus and racing.**
- **Disc:** the runtime does **not** use nod or Aurora DVD. It reads a pre-extracted `DATA/`
  tree (`files/`, `sys/fst.bin`) chosen by `paths.dvd_root`; reads are synchronous host file I/O
  copied into guest RAM. The Setup tool runs `nodtool extract` for the whole data partition
  (about 2.5 GiB; 5 GiB budget) and hashes `main.dol`/`StaticR.rel`. DOL/REL code and data are
  compiled into the executable.
- **NAND / saves:** host directory tree under `<AppData>/NAND`, guest paths mapped 1:1; seeded
  from `runtime/assets/wii/shared2/wc24`. IOS devices HLE'd: `/dev/fs`, `/dev/es` (4 ioctls),
  `/dev/sha`, `/dev/dolphin`, `/dev/net/{ip/top,ssl,kd/*,ncd/manage}`. SYSCONF replaced by
  `setting.txt` + `SC*` HLE. Mii resources extracted from the disc on demand. Minimal and
  filesystem-shaped: maps directly onto a virtual FS.
- **Network:** BSD sockets inline in `hle/net/network_socket.cpp`; TLS via Schannel (Windows) or
  mbedTLS with `cacert.pem` elsewhere, through `mbedtls_ssl_set_bio` callbacks; DNS on detached
  threads with completions pumped on the guest thread. `NetworkEnabled(false)` is a supported
  offline mode that keeps KD/NCD working for saves and licences. Retro-WFC is a guest-side payload
  (hostname redirection compiled into the Retro Rewind product); the host only special-cases NAS
  `POST /ac` buffering.
- **Third-party:** cryptopp (no asm), libco, pugixml, toml11 vendored; mbedTLS fetched; Aurora
  fetches SDL3 3.4.4, nod (Rust, Corrosion), a prebuilt Dawn package; Aurora's extern has abseil,
  xxhash, fmt, zlib, libpng, freetype, imgui, sqlite3, zstd, tracy.
- **Licensing:** WiiCompiled GPLv3 ("Any mkwii distribution making use of WiiCompiled must be
  licensed under GPL v3.0"); contains GPL-2.0-or-later Dolphin-derived data. Aurora MIT.
  CONTRIBUTING: AI tools allowed; contributor must be able to explain every line; PR descriptions
  must be human-written; one change per PR; hardware-identical behaviour for anything touching the
  game. Never include Nintendo data anywhere.

## 4. Aurora on the browser: what melee-pc changed (`64b4642`)

Everything under `__EMSCRIPTEN__` except an inert pipeline-queue flag:

- `cmake/AuroraDawnProvider.cmake`: when `EMSCRIPTEN`, create an INTERFACE target aliased to
  `dawn::webgpu_dawn` and `dawn::dawncpp_headers` carrying `--use-port=emdawnwebgpu`.
- `aurora_core.cmake`/`aurora_gx.cmake`: do not define `WEBGPU_DAWN` (gates `dawn/native` code).
- `lib/webgpu/gpu.cpp`: no `SetLoggingCallback`, no `maxImmediateSize`, force
  `BackendType::WebGPU` (browsers hide the native backend).
- `lib/dawn/BackendBinding.cpp`: surface from `wgpu::EmscriptenSurfaceSourceCanvasHTMLSelector`
  with selector `#canvas`.
- `lib/gx/gx.cpp`, `frame.cpp`, `encoding.cpp`: **inline GX processing** (a browser device is only
  usable from the realm that created it), a CPU staging arena uploaded with `Queue.WriteBuffer`
  for the used ranges instead of mapping 87 MiB of staging buffers per frame
  (`lib/gfx/browser_upload.js`, 27 lines).
- `pipeline_cache.cpp`, `pipeline.cpp`, `shader.cpp`: asynchronous pipeline creation; draws whose
  pipeline is still compiling are skipped; cached pipelines compiled behind a progress callback
  before the game starts (`browser_prepare_graphics`); SQLite `journal_mode=MEMORY`.
- `AR.cpp`, `render_worker.cpp`, `command_processor.cpp`, `fifo.cpp`: cooperative ARQ/completion
  delivery instead of worker threads.
- `extern/CMakeLists.txt`: patch imgui's wgpu backend for modern Dawn headers.

Link flags used by melee-pc: `-sPTHREAD_POOL_SIZE=4 -sASYNCIFY_IMPORTS=browser_disc_read
-sASYNCIFY_STACK_SIZE=1MiB -sSTACK_SIZE=8MiB -sINITIAL_MEMORY=256MiB -sMAXIMUM_MEMORY=2GiB
-sEMULATE_FUNCTION_POINTER_CASTS=1 -lidbfs.js`, link at `-O1` then `wasm-opt -O3` as a second pass.
Result: p95 frame time 17 to 19 ms, about 5 s from click to gameplay, COOP/COEP via a service
worker on GitHub Pages.

Measured incompatibilities between emdawnwebgpu and native Dawn that both ports hit: no
`dawn::native` toggles/instance descriptor, no `SetLoggingCallback`, `SurfaceSourceCanvasHTMLSelector`
renamed with `Emscripten` prefix, `<dawn/webgpu_cpp.h>` is `<webgpu/webgpu_cpp.h>`, `WaitAny` on
adapter/device requests needs Asyncify or JSPI, `wgpuDeviceCreateBindGroup` does not retain C
handles (cache must hold references), buffer mapping is expensive (prefer `WriteBuffer`).

WiiCompiled's `aurora-main` additionally has: frame worker thread, presenter thread with
`wait_until_precise` sleeps, interpolation worker pool, `TimedWaitAny` instance feature request,
`ImplicitDeviceSynchronization`, EFB-to-RAM copies with synchronous readback waits. All of these
need the single-thread treatment melee-pc applied, plus a present-per-rAF scheme for interpolation.

## 5. Browser incompatibility classification

| # | Area | Finding | Class | Resolution |
|---|---|---|---|---|
| 1 | Emitted C++ | Portable C++17; no intrinsics/asm/SEH/uintptr_t in emitter strings | **GREEN** | None needed in the translator for correctness |
| 2 | ISA headers: SIMD paired-single/PSQ | `#error` outside x86_64/aarch64; `__m128`/NEON only, including FMA3 | **YELLOW** | Add a wasm backend. Spike shows Emscripten's SSE compat layer compiles all of it except `_mm_fmadd_ps`, `_mm_fmsub_ps`, `_mm_setcsr`. Production: `wasm_simd128` lanes with per-lane `std::fma`, or scalar path |
| 3 | ISA headers: FP environment (MXCSR FTZ/DAZ) | `#error` elsewhere; no FTZ in wasm | **YELLOW** (accuracy) | No-op backend; software pre-round flush already exists. Intermediate-result FTZ is lost: small, likely invisible deviation; must be validated with ghost sync |
| 4 | FMA exactness and cost | `std::fma` is correct but a soft-float libcall in wasm | **YELLOW** (perf) | Measure. Options: keep exact soft fma on hot paths; `-msimd128` for everything else |
| 5 | NaN payload propagation | x86-tuned; wasm non-deterministic | **YELLOW** (low) | Document; test with ghosts |
| 6 | Guest memory: fixed 4 GiB VA + page faults | Impossible in wasm32 | **YELLOW** | Checked page-table path exists and is 32-bit safe; WiicompiledWeb's `MKW_CHECKED_GUEST_MEMORY` backend is implemented and tested; our spike confirms. Cost: one table load + add per access |
| 7 | `FlatWriteRam*`/`FlatLoad` unconditional fixed base | Only unconditional users | **GREEN** | 16-line header gate (already in the fork) |
| 8 | Memory size | 155 MiB guest + runtime + GPU staging | **GREEN** | wasm32 with growth to 2 to 4 GiB; no memory64 |
| 9 | Fibers / stack switching | libco/Win32 fibers; `#error` elsewhere; switches deep inside translated call chains | **RED→YELLOW** | `HostContext` is a 6-function seam. Emscripten fibers need Asyncify mode 1, which instruments all translated code reachable from a yield. JSPI has no symmetric fibers. Decision pending measurement (see ADR) |
| 10 | Blocking main loop | `sleep_until`/spin in VI pacing, idle loop, Aurora presenter | **YELLOW** | Convert the two wait points into yields to the event loop; present per rAF; interpolation slots across successive rAFs |
| 11 | Aurora fork threads | frame worker, presenter, interpolation pool, cache writer | **YELLOW** | Force inline paths (fallbacks exist for most); re-apply melee-pc hunks |
| 12 | Aurora WebGPU API dialect | dawn::native, logging callback, surface source, timed waits | **GREEN** | Exact hunks exist in melee-pc `64b4642` |
| 13 | C++ exceptions, setjmp | checked path throws; sigsetjmp around ctors | **GREEN** | `-fwasm-exceptions -sSUPPORT_LONGJMP=wasm` (spike used these); compile out fault handlers. Note dusk-wasm found JS `invoke_*` trampolines incompatible with JSPI |
| 14 | Build system | 64-bit/platform/Release gates, `.incbin` `.S` blobs, `-march=x86-64-v3` | **YELLOW** | New toolchain branch; emit data blobs as C arrays or runtime-loaded files for wasm |
| 15 | Module size / link time | about 28k functions, hundreds of MB of C++, about 2 GB RAM per shard | **YELLOW→RED** if Asyncify | wasm-ld + wasm-opt over one module; Asyncify multiplies size. Needs measurement on real output |
| 16 | Audio | SDL3 audio stream push model | **GREEN** | SDL3 has an Emscripten audio backend; melee-pc uses "SDL pump". Custom AudioWorklet only if latency demands |
| 17 | Input | Aurora PAD over SDL3 gamepad | **GREEN** | SDL3 Emscripten gamepad backend wraps the Gamepad API; Wii Remote path skipped |
| 18 | Disc | Runtime wants an extracted `DATA/` tree, synchronous reads | **YELLOW** | Phase 1: directory of extracted files in OPFS, synchronous reads via OPFS sync access handles in a worker, or Asyncify/JSPI-suspended reads from `File`. Phase 3: nod in wasm (proven by dusk-wasm) for in-browser extraction of Wii partitions |
| 19 | NAND / saves / config | Plain host directory tree | **GREEN** | IDBFS or OPFS-backed VFS; export/import |
| 20 | Network | BSD sockets inline; TLS via mbedTLS BIO | **YELLOW** (deferred) | Offline adapter first. Swap point: `NativeSocket` helpers (`network_internal.h:207-247`) behind a shim; TLS stays in wasm over a proxied stream; P2P UDP needs WebRTC |
| 21 | Translation in-browser | .NET translator + clang + hundreds of MB C++ | **RED** | Not a port problem; a product-architecture decision (see ADR). Desktop helper first |
| 22 | Distribution | Generated bundle embeds raw game data sections | **RED** (legal) | Never host translated output. Private per-user bundle only |

## 6. Spike: lean runtime to wasm32 (Milestone 1, partial; superseded by Minithena's full port, kept as evidence)

Script: `spikes/wasm-lean-runtime/build.sh`. Target: the translator test harness's "lean runtime"
set (`abi_bridge.cpp`, `fpu_helpers.cpp`, `memory.cpp`, `ppc_helpers.cpp`) plus the fork's wasm32
guest-memory backend, compiled with Emscripten 6.0.11.

**Pass 1 (unmodified upstream, no flags):** every TU fails at exactly three header families:

```text
runtime/include/isa/ppc_isa_config.h   #error no SIMD intrinsics header for this architecture
runtime/include/isa/ppc_isa_fpenv.h    #error no host FP control register mapping
runtime/include/isa/ppc_isa_float.h    unknown type name 'PpcPairVec' (x10)
runtime/include/guest_flat_memory.h    #error no fixed flat guest base chosen
runtime/include/memory_access.h        no member 'kFixedFlatGuestBase' (x3)
```

**Pass 2 (`-msimd128 -mavx -D__x86_64__`, Emscripten SSE/AVX compat layer):** the whole SSE
paired-single and PSQ implementation compiles. Only three identifiers are missing:
`_mm_fmadd_ps`, `_mm_fmsub_ps` (FMA3) and `_mm_setcsr`.

**Pass 3 (shim for those three, fork's `MKW_CHECKED_GUEST_MEMORY` backend,
`-fwasm-exceptions -sSUPPORT_LONGJMP=wasm`):** compiles and links to a 216 KB `.wasm`. The harness,
run under Node, passes all 14 checks:

- `PPC_Fsel` and `PPC_PsSel` NaN and signed-zero control semantics (same checks as the upstream
  `FselAndPsSelMatchDolphinForNaNAndSignedZeroControls` test).
- `PPC_PsMaddInline` produces the exact single-rounding result of `std::fma` per lane.
- `MemoryInline::FlatWrite32` at `0x80001000` read back through the `0xC0001000` alias; float
  round trip; big-endian byte order preserved via `FlatRead8`.
- `FlatRead32(0xCC008000)` (GX FIFO MMIO) reaches policy and throws instead of reading RAM.

What the spike does not prove: generated game code (no dump available), fibers, Aurora, performance,
module size at 28k functions.

## 6b. Spike: the user's disc read in the browser (M3 feasibility)

`spikes/disc-wasm`: nod built for `wasm32-unknown-unknown` with no C dependencies (401 KB), opened
through one host read callback. Against the NTSC-U WBFS: game ID in 18 ms (9 reads, 8.4 MB), FST of
2007 files (2.50 GiB) in 33 ms, `main.dol` and `StaticR.rel` read with hashes identical to the
region manifest, a 2.5 MB course archive in 16 ms. The same ABI runs in a Web Worker on
`FileReaderSync`; see the spike README for the lazy-mount versus extract-to-OPFS designs.

## 6c. NTSC-U build and boot (2026-10-02, late)

The available dump is NTSC-U. With upstream PR #247 merged onto Minithena's web branch
(`athena-web-ntsc`), translation produced 72 shards in minutes and the Emscripten build linked a
107 MB wasm. Driven in Google Chrome 154 on an RTX 4090 (X11), it boots to the title screen at
60.0 FPS with about 12 ms guest CPU per frame, no frames over 25 ms and zero slow-path memory
accesses. Two Linux fixes were needed: the configure-time blob converter only matched Mach-O
symbol names, and a wasm test needed a growable heap.

## 7. The twenty questions, answered with evidence

1. **Can generated code target wasm32?** Yes. The emitted C++ is portable; the blockers are in
   runtime headers it includes (sections 3.5, 6).
2. **Does it require 64-bit host pointers?** No. `CpuContext` is pointer-free; guest addresses are
   `uint32_t`; the checked path is modulo-2^32 safe. Only the flat fast path needs 64-bit VA.
3. **Can guest memory live in wasm linear memory?** Yes: about 155 MiB; implemented and tested
   in the WiicompiledWeb fork; confirmed by our spike.
4. **Fixed host virtual addresses?** Only on the flat path. Not on the checked path.
5. **Can fibers run in a browser scheduler?** Yes, proven: Minithena implements symmetric fibers on
   JSPI (`mkw_fibers.js`), each context as its own `WebAssembly.promising` call with the C stack
   pointer swapped by JS, about 3 µs per switch, no Asyncify instrumentation of translated code.
6. **Single-threaded initially?** Yes. Guest is already single-threaded; every other host thread
   has an inline fallback or is droppable, except Aurora's frame worker/presenter which melee-pc
   showed how to run inline.
7. **Can Aurora compile under Emscripten?** Yes: melee-pc and dusk-wasm both do. WiiCompiled's
   fork has not been tried; it has extra threads.
8. **Browser-native WebGPU instead of Dawn?** Yes, via emdawnwebgpu, in production at smash.fun.
9. **Native Dawn extensions relied upon:** `dawn::native` instance/toggles descriptor,
   `SetLoggingCallback`, `TimedWaitAny`, `ImplicitDeviceSynchronization`, `maxImmediateSize`,
   native surface sources, synchronous `WaitAny` with timeout.
10. **Removable behind an abstraction?** Yes; melee-pc's 329-line patch is that abstraction.
11. **SDL3 in the browser?** Yes: Aurora builds SDL3 for Emscripten; gamepad and audio backends
    exist. Phase 1 should use them rather than hand-written Gamepad/AudioWorklet adapters.
12. **Audio replacement?** Probably nothing initially: SDL3 audio stream → Emscripten backend.
    Instrument underruns; replace with a custom worklet only if needed.
13. **nod from the File API?** Yes, proven in `spikes/disc-wasm`: stable Rust, `wasm32-unknown-unknown`,
    no C deps, 401 KB, opens and decrypts a WBFS through a synchronous read callback in milliseconds.
14. **Persistent storage needed?** Extracted data about 2.5 GiB (KartPad figure) plus the private
    wasm bundle (tens of MB plus Asyncify overhead) plus saves/caches. OPFS handles this on
    desktop Chrome; request `navigator.storage.persist()`.
15. **Cache generated data in OPFS?** Yes, technically. Legally it stays on the user's device;
    it is their derived work from their dump, same as the current desktop install.
16. **Nintendo-derived information in generated output?** Translated code (derived) and the raw
    `.data/.rodata/.sdata` sections via `.incbin`. Also `MAP.txt` symbol names in the repo are
    public community symbols.
17. **Distributable vs local?** Distributable: runtime, Aurora, translator, browser shell, build
    tooling. Local only: everything derived from the dump, including the wasm bundle.
18. **Wii OS services MKW requires?** OS threads/alarms/messages/mutex/time/cache HLE; VI; AI/DSP
    (AX HLE); GX; PAD (WPAD/KPAD optional); DVD; NAND (`/dev/fs`, `/dev/es` 4 ioctls, `/dev/sha`,
    KD/NCD minimal); SC settings. IOS proper is not emulated.
19. **Stubbable in-browser?** Music ducking, Discord presence, fatal popups, transcript pipes,
    Wii Remote, libusb adapter, networking (offline mode), pipeline cache writer thread.
20. **First real blocker to a playable race?** None remains for a locally built bundle: Minithena's
    `web` branch plays races. The first blocker for *our* stated end state is M3, reading and
    extracting the user's own disc in the browser instead of streaming a pre-extracted tree from a
    server the user controls.

## 8. Open items requiring measurement, not reading

- Asyncify size and speed multiplier on a real 28k-function module; whether translator-emitted
  `ASYNCIFY_REMOVE` lists (state-free leaves, non-yielding HLE) keep it tolerable.
- Whether Asyncify can unwind through `-fwasm-exceptions` frames in Emscripten 6.x, or whether the
  checked-memory `AccessViolation` throws must become error returns on yield-capable paths.
- Soft-float `fma` cost in the paired-single hot path.
- OPFS sync-access-handle throughput for the DVD HLE's synchronous reads in a worker.
- Link time and peak RAM for wasm-ld + wasm-opt over the full module.
- Upstream WiiCompiled's position on a wasm target and on the WiicompiledWeb fork.
