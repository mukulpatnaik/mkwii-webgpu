# Mario Kart Wii in the browser: critique of the original brief and the final plan

Date: 2026-10-02. Evidence for every claim is in [research-browser-port.md](research-browser-port.md);
decisions are recorded in [adr/0001-browser-architecture.md](adr/0001-browser-architecture.md).

## Part 1: critique of the original brief

The brief is a good checklist. Its risk model, ordering and product assumptions are wrong in
specific ways that the code and the ecosystem now contradict.

1. **Graphics is not the open problem.** The brief spends its longest section on inventing an
   Aurora browser backend (Routes A/B/C) and makes "render an Aurora test scene in Chrome" a
   milestone. That was merged into melee-pc on 2026-09-23 (329-line Aurora patch, all under
   `__EMSCRIPTEN__`, 60 fps in production at smash.fun) and reproduced by dusk-wasm. Milestone 2 as
   written is already done by other people. The real graphics work is narrower and different:
   re-apply that patch to WiiCompiled's **diverged Aurora fork** and neutralise the fork's own
   threads (frame worker, presenter, interpolation pool, EFB readback waits).

2. **Guest memory is not the highest risk.** The brief calls it "probably the highest-risk area".
   The runtime already has a checked page-table access path that is correct with 32-bit pointers;
   the WiicompiledWeb fork implemented and tested the wasm32 backing on 2026-09-26; our spike ran
   it under Node today. It is a YELLOW item with a known 16-line header change and an 80-line
   backend. The highest risks are, in order: stack switching for guest fibers (and Asyncify's
   cost on a 28k-function module), the blocking main loop, and floating-point exactness/performance
   (soft `fma`, no FTZ).

3. **"Can translated code target wasm32?" was framed as a translator question. It is a runtime
   header question.** The emitter produces portable C++; every failure in the spike came from
   `runtime/include/isa/*.h` (SSE/NEON-only paired-single and PSQ code, MXCSR control) and
   `guest_flat_memory.h`. The archived mkwii-web project drew the wrong conclusion ("the emitter
   emits x86-specific constructs") and gave up. Do not repeat that; no emitter change is needed for
   correctness.

4. **The brief under-weights the translation-model decision and over-promises the end state.**
   "User visits a website, selects a disc, plays" requires either running the .NET translator plus
   a C++ compiler in the tab (hundreds of MB of generated C++, about 2 GB RAM per shard natively)
   or writing a wasm backend for the translator. Both are large projects, not ports. Meanwhile the
   generated bundle embeds raw `.data/.rodata` game sections via `.incbin`, so hosting a prebuilt
   bundle is off the table, legally and by upstream policy. The honest Phase 1 product is a static
   shell plus a desktop helper producing a private bundle. The brief lists this as a mere
   "preprocessing helper to simplify development" option. It is the architecture for the first
   playable milestone.

5. **Threads: right instinct, missing mechanism.** The brief says "prefer single-threaded" and
   "do not reach for Asyncify globally without measurement". Both are correct, but the guest is
   already single-threaded and cooperative, so the question is purely how to switch stacks in wasm.
   There are exactly two shipped mechanisms: Emscripten fibers (Asyncify mode 1, instruments all
   reachable code) and JSPI (shipped in Chrome 137+, but no symmetric fibers; a custom
   stack-pointer scheme would be needed). A stackless rewrite of the translator output is RED and
   not worth it. The plan must make this a measured decision gate, not a preference.

6. **Audio and input adapters are probably unnecessary in Phase 1.** The runtime pushes PCM into an
   SDL3 audio stream and reads pads through Aurora/SDL3 `SDL_Gamepad`. SDL3 ships Emscripten audio
   and gamepad backends and Aurora already builds SDL3 for Emscripten. The brief's custom
   AudioWorklet and Gamepad API adapters should be measured-in, not planned-in.

7. **Disc pipeline assumptions are inverted.** The brief centres on nod in wasm reading the ISO
   incrementally. WiiCompiled's runtime never touches the ISO at play time; it reads a pre-extracted
   `DATA/` tree (about 2.5 GiB) through synchronous host file I/O. For Phase 1 the browser needs an
   OPFS-backed directory and a synchronous-read strategy (worker with sync access handles, or a
   suspended read). nod-in-wasm matters only for the Phase 3 browser-only setup, where dusk-wasm has
   already proven it compiles.

8. **Networking section is fine but names the wrong layer.** The cleanest swap point is not the
   IOS device layer but the `NativeSocket` helpers in `hle/net/network_internal.h`, with TLS kept
   in wasm (mbedTLS over a proxied stream). Retro-WFC is a guest-side payload; the host does no
   protocol rewriting. The brief's conclusions (offline first, WebSocket/WebTransport for TCP,
   WebRTC for peer UDP) stand.

9. **Missing: existing efforts to join.** The brief says to prefer contributing to an existing
   browser effort. One exists for WiiCompiled itself (OtherShindo957/WiicompiledWeb, with an audit,
   probe, CI and the memory backend), and one for Aurora (melee-pc, whose author has not yet
   upstreamed the patch to encounter/aurora). The plan must start by coordinating with both.

10. **Missing: build-system and data-blob blockers.** 64-bit-only and platform allowlist gates,
    Release-only, `-march=x86-64-v3` in the test harness, and `.incbin` assembly blobs that have no
    wasm equivalent. Small, but they stop any build before the interesting problems appear.

11. **Missing: floating-point fidelity risk.** Paired-single exactness depends on real FMA
    (`std::fma` becomes a soft-float libcall in wasm), FTZ/DAZ on intermediates is unavailable, and
    NaN payload propagation differs. The project's physics-parity claim rests on ghost replays, so
    the browser build needs the same ghost-sync validation before it can claim parity.

12. **Milestone ordering.** M1 (wasm feasibility) is partly retired today; M2 (Aurora spike) is
    retired by prior art; M4 (game-data pipeline) as "select ISO, extract required files in the
    browser" belongs to Phase 3. The sequence should be reordered around the actual first blocker:
    producing a translated bundle that links for wasm, then running it on one thread.

13. **Contribution policy constraints the brief did not mention.** WiiCompiled accepts AI-assisted
    code but requires human-written PR descriptions, the ability to explain every line, one change
    per PR, and hardware-identical behaviour evidence for anything touching the game. dusk-wasm
    refuses primarily-AI-generated contributions. Plan PR sizes and review effort accordingly.

What the brief got right and the plan keeps: WebGPU-first with no WebGL2; keep MKW's own menus;
simulation decoupled from display refresh; OPFS for large data; instrumentation from day one;
Chrome/Edge first; networking architecture preserved but deferred; Retro Rewind later; upstreamable
patches over a permanent fork.

## Part 1b: addendum, later on 2026-10-02

After Part 1 was written, Minithena/Wiicompiled branch `web` and Minithena/mariokartwebtest were
found (see research report, section 2). They are a working browser port: races run in Chrome and
Firefox, the native reference ghost replays identically, 60 FPS on an M5, private invite rooms over
a Cloudflare relay. Their notes list exactly the items they have not done: players bringing their
own disc (deferred by the owner), presentation tied to display refresh, slower hardware, a
two-machine online test, Safari, non-Mac build hosts.

Consequences for the plan below: Phases 1 and 2 collapse into "build their branch here and verify
it"; our own work starts at M3 (local disc in the browser), which is the one requirement of the
original brief they do not meet. The phase descriptions below are kept for the reasoning; the
**revised sequence** is:

1. **Reproduce on Linux** (in progress): build `Minithena/Wiicompiled` `web` with our Emscripten,
   translate the user's dump with the upstream translator, stage with their tools, play locally
   from `tools/serve.py`. Record the ghost-sync check. Fix any Mac-only assumptions (`stage-web.sh`
   save path, `nodtool` download, dotnet paths) and offer those fixes back.
2. **M3, local disc:** page accepts an ISO/WBFS/RVZ `File`; a worker validates the `RMCP01` header
   and hashes; decrypts the data partition and extracts only the files the game opens (the FST is
   known) into OPFS, using nod compiled to wasm (dusk-wasm recipe) or a small Wii partition reader;
   mount `/game` from an OPFS-backed WASMFS directory instead of the fetch backend; keep the
   manifest-driven prefetch logic working against OPFS; "Clear Local Game Data".
3. **Presentation on the display's frame callback** (their known issue 2) so 120/144 Hz and 59.94 Hz
   displays do not judder; interpolation slots per rAF.
4. **Bundle distribution for the user's own machine:** the private `WiiCompiled.{html,js,wasm,data}`
   is produced on the user's machine; the public site hosts only the page. Investigate letting the
   page load a user-supplied bundle from OPFS so the site needs no per-user hosting at all.
5. Later: WebRTC for peer UDP (their relay already works), slower-hardware pacing, Safari.

Region note (2026-10-02, evening): the available dump is **NTSC-U (`RMCE01`)**, which upstream
WiiCompiled rejects (PAL-only, hash-pinned). Upstream PR patchzyy/Wiicompiled#247 (DarthMDev,
superseding rooklz's #104) adds NTSC-U/J/K through per-region guest-address tables
(`runtime/include/region/*.h`, `MKW_GADDR(palAddress)` identities, `projects/mkwii-ntsc-u/`); the
maintainer called the foundation good and asked for setup/NAND integration fixes, which the author
posted on 2026-09-24. The dump's `main.dol` and `StaticR.rel` hashes match that PR's NTSC-U manifest
exactly. It merged onto Minithena's `web` branch with a single conflict (`abi_bridge.h`); Minithena's
web hooks name 43 PAL addresses that are not in the region tables, so they are compiled only for PAL
(`platform/web/web_region.h`) until ported with `tools/region`. Our working branch is
`athena-web-ntsc`. Consequence: on NTSC-U the web build runs without real-time catch-up, lag-wait
removal, race-asset warming and invite rooms until those identities are ported.

Coordination: open an issue on Minithena/mariokartwebtest describing M3 work before starting it,
and offer the Linux build fixes as a PR to `Minithena/Wiicompiled` `web`. Their repo is public and
GPLv3; their notes explicitly plan M3 as "a later version", so this is a contribution, not a fork.

## Part 2: final plan (original phases, kept for reasoning; see Part 1b for the revised sequence)

### Product shape

```text
Phase 1-2 (first playable):
  static site (runtime+Aurora wasm, shell)  +  desktop helper (translator + emcc)  →  private bundle in OPFS
Phase 3 (browser-only setup):
  decision gate: in-tab translate+compile  vs  translator wasm backend  (measured, not assumed)
Phase 4: online (WebSocket/WebTransport gateway + WebRTC), Retro Rewind
```

### Phase 0: research and coordination (done / this week)

- [x] Clone and pin WiiCompiled, Aurora, melee-pc, WiicompiledWeb, goldenballoon. Build translator; 641 tests pass.
- [x] Spike: lean runtime + checked guest memory + FP helpers to wasm32, 14/14 semantic checks pass in Node (`spikes/wasm-lean-runtime`).
- [x] Research report and ADR.
- [ ] Contact OtherShindo957 (WiicompiledWeb) to coordinate; propose merging efforts on their fork.
- [ ] Contact turtlesoupy (melee-pc) about upstreaming `64b4642` to encounter/aurora.
- [ ] Ask WiiCompiled maintainers in issue #124 whether a `runtime/src/platform/web` target is welcome upstream.

### Phase 1: a translated bundle that links and boots on one thread (Milestones 1b to 3)

Exit criterion: WiiCompiled's own boot sequence runs in Chrome from a locally built private
bundle until the first `VI_HLE_PresentFrame`, with instrumentation reporting module size, link
time, startup time and per-frame cost.

Work items, each a focused PR against the fork (or upstream if welcomed):

1. **ISA wasm backend** (`runtime/include/isa/`): `#elif defined(__wasm__)` branch. Paired-single
   and PSQ via `wasm_simd128.h` lanes with per-lane `std::fma` for exactness; FP-env hooks become
   no-ops while keeping the software pre-round flush. Port the existing PSQ ISA tests (#278) to run
   under Node as the conformance gate. Spike data point: Emscripten's SSE compat compiles the x86
   path except FMA3 and MXCSR, so a transitional build is possible immediately.
2. **Checked guest memory**: adopt the fork's `MKW_CHECKED_GUEST_MEMORY` backend and header
   gates; add the sanitizer and Node tests to CI.
3. **Build target**: relax the 64-bit/platform/Release gates behind an `MKW_PLATFORM_WEB` toolchain
   branch; emit data blobs as C arrays or loadable files instead of `.incbin`; `-fwasm-exceptions
   -sSUPPORT_LONGJMP=wasm`; compile out SIGSEGV/VEH handlers.
4. **Milestone 1b, the measurement that decides D3**: translate a real dump locally (requires a
   PAL `RMCP01` dump on the dev machine), compile all shards with `emcc`, link with and without
   `-sASYNCIFY`, and record module size, link time, peak RAM, and a micro-benchmark of a hot
   translated function. Translator emits `ASYNCIFY_REMOVE` lists for state-free leaves and
   non-yielding HLE. Go/no-go for Asyncify fibers; otherwise JSPI custom fibers or
   `PROXY_TO_PTHREAD`.
5. **HostContext for Emscripten**: `emscripten_fiber_*` backend; 1 MiB C stack + Asyncify data per
   fiber; `main()` runs the guest entry inside a fiber.
6. **Main loop**: `VI_HLE_WaitForNextRetracePoll` and `PaceToRetraceBoundary` yield to the
   browser; rAF resumes the guest; other sleeps (`gx_frame.cpp` retry, `GKI_delay`, reset) become
   yields. Simulation stays on the VI wall clock.
7. **Aurora fork on Emscripten**: port `64b4642`; force inline frame processing; disable presenter
   and interpolation workers; present on rAF; bind-group cache holds references; pipeline cache
   `journal_mode=MEMORY`; pre-compile cached pipelines behind a loading screen.
8. **Host services**: SDL3 Emscripten audio + gamepad through the existing paths; stub music
   ducking, Discord, popups, transcript pipes, Wii Remote, libusb; `NetworkEnabled=false`.
9. **DVD backend**: `DiscReader` seam in `hle/storage/dvd.cpp`; OPFS directory of the extracted
   tree; synchronous reads via sync access handles in a worker or suspended reads; bounded cache.
10. **NAND/config**: IDBFS or OPFS VFS mounted before `Config.toml`; Web Locks; export/import.
11. **Desktop helper**: one command that runs nodtool extract, the translator, and emcc with the
    pinned toolchain, producing `bundle/` for the page. Reuse the existing Setup CLI where possible.
12. **Shell**: minimal page: pick bundle + data directory, store in OPFS, status, Start, Clear
    Local Game Data; COOP/COEP headers (or service worker) if threads are ever enabled;
    WebGPU preflight; perf HUD (frame time, sim time, JS↔wasm crossings, audio underruns).

### Phase 2: playable (Milestones 5 to 9)

- First MKW frame; menus with a gamepad; one complete race with audio.
- **Physics parity gate**: run the project's ghost-sync validation in the browser build (ghosts
  are input replays, so divergence is detectable). Investigate any divergence against the FTZ/NaN
  deviations noted in the research report.
- Saves and settings survive reload; four local controllers (SDL3 gamepad slots → Aurora PAD ports).
- Interpolation on high-refresh displays as present-per-rAF of slot images; measure before enabling.
- Packaging: static deploy of the public parts; private bundle never leaves the device.

### Phase 3: browser-only setup (decision gate, not a promise)

Measure both options with the Phase 1 artefacts as ground truth:

- **A. In-tab translate + compile**: translator as a wasm/.NET-in-browser host; a wasm-hosted clang
  and linker; hundreds of MB of C++ and a 2 GB-per-shard heap profile to tame. Likely infeasible
  without major translator changes; measure anyway.
- **B. Translator wasm backend**: keep the PowerPC frontend and IR; emit wasm functions, data and
  the dispatch table directly; structured control flow, suspension points, and FP fidelity must be
  proven against the C++ emitter on synthetic cases first. This is the path that makes the brief's
  end state real.
- Either way: nod in wasm (dusk-wasm recipe: Rust nightly, `panic=abort`) for partition decryption
  and selective extraction from `File.slice()`; cache by dump digest + toolchain version in OPFS.

### Phase 4: online and Retro Rewind

- Shim `NativeSocket` helpers; TCP via a WebSocket/WebTransport gateway; peer UDP via WebRTC data
  channels; mbedTLS stays in wasm. Retro-WFC payload translation is already static in the Retro
  Rewind profile; the browser only needs the socket shim and a gateway operator.
- Retro Rewind as a second private bundle profile.

### Decision gates and metrics to record from the start

| Gate | Metric | Threshold to proceed |
|---|---|---|
| Asyncify fibers (M1b) | wasm size, link time, hot-function slowdown | size under about 100 MB uncompressed; slowdown under 2x on translated hot paths |
| FP fidelity (Phase 2) | ghost replay divergence | zero divergence on a reference ghost set |
| Frame budget | sim time + GX HLE + Aurora encode per 60 Hz frame | p95 under 16 ms on a mid-range desktop GPU |
| Storage | OPFS footprint, read throughput | about 3 GB fits; DVD reads never stall a frame |
| Startup | pick-to-first-frame | under 10 s with a warm pipeline cache |

### Risks and fallbacks

- Asyncify too expensive → JSPI custom fibers (stack-pointer swap) or guest on a worker with
  `PROXY_TO_PTHREAD` and Asyncify confined to the worker.
- Upstream declines a web target → keep the fork small; Aurora patch still upstreamable to
  encounter/aurora via melee-pc's author.
- Soft `fma` too slow → profile; most paired-single math is in physics, which must stay exact;
  consider `-msimd128` elsewhere only.
- OPFS sync reads unavailable on the main thread → run the guest on a worker (dusk-wasm model) and
  transfer the canvas.

### What not to do

- Do not host or share translated output or extracted data, even for CI.
- Do not write a WebGL2 GX renderer.
- Do not write custom Gamepad/AudioWorklet adapters before measuring SDL3's.
- Do not start a third WiiCompiled browser fork before talking to the existing one.
- Do not claim physics parity before ghost-sync passes in the browser build.
