# ADR 0001: Browser architecture for a WiiCompiled-based Mario Kart Wii port

Status: Proposed (2026-10-02), amended the same day after finding Minithena's working port. Supersedes the architecture sketch in the original project brief.
Evidence: [docs/research-browser-port.md](../research-browser-port.md).

## Context

- WiiCompiled statically translates MKW PAL (`RMCP01`) PowerPC into C++ and links it with a
  runtime; graphics go through a vendored, heavily modified fork of Aurora whose GX layer targets
  WebGPU through native Dawn.
- Aurora already runs on browser WebGPU through emdawnwebgpu in two independent ports
  (melee-pc, merged; dusk-wasm). The Aurora delta is about 330 lines.
- WiiCompiled's runtime is 64-bit-only, x86/ARM-only in its ISA headers, uses a 4 GiB fixed
  virtual-address guest window with page-fault interception, stackful fibers for guest threads,
  and a blocking main loop. All of these have identified seams, and a checked-memory wasm32
  backend already exists in the WiicompiledWeb fork.
- The translated output embeds raw game data sections and derived code. It can never be hosted.
- The translator is a .NET 8 application that emits hundreds of megabytes of C++ compiled with
  about 2 GB RAM per shard. Running that pipeline inside a browser tab is a separate, large
  project, not a port.

## Amendment (2026-10-02, later the same day)

Minithena/Wiicompiled branch `web` (with Minithena/mariokartwebtest) is a working browser port:
races run, the native ghost replays identically, 60 FPS, private online rooms. It already made
several of the decisions below, in some cases better than proposed here. We adopt it as the base:

- **Base:** our working fork tracks `Minithena/Wiicompiled` `web`; our changes go on top in
  `runtime/src/platform/web/` or behind `__EMSCRIPTEN__`, so both their updates and upstream's
  can be merged.
- **D3 revised:** fibers are JSPI coroutines (their `mkw_fibers.js`), not Asyncify fibers. The
  game runs on a proxied pthread (`-sPROXY_TO_PTHREAD`, `OFFSCREENCANVAS_SUPPORT`) with a small
  worker pool; the main thread owns the page. Asyncify is not used anywhere.
- **D5 confirmed:** SDL3's Emscripten audio and input backends are what they use.
- **D6 confirmed:** OPFS for user state.
- **D7 changed:** their disc path is a WASMFS *fetch* backend streaming a pre-extracted tree from
  a server the user hosts. That is their M2. **Our contribution is M3:** the user selects the disc
  image in the page; the browser validates `RMCP01`, decrypts the data partition and extracts the
  files it needs into OPFS (nod compiled to wasm, or a purpose-built Wii partition reader), and a
  WASMFS OPFS-backed `/game` replaces the fetch mount. Nothing leaves the device.
- **D1 narrowed:** the "desktop helper" is their existing build flow (translator + emcmake), which
  we make reproducible on Linux and document; the private bundle is `WiiCompiled.{html,js,wasm,data}`.
- **D8 changed:** their online path is a WebSocket relay through a Cloudflare Durable Object
  (AGPL-3.0), already working for lobbies. WebRTC remains a later optimisation for peer UDP.

## Decisions

### D1. Two-stage product: private bundle now, browser-only setup later

Phase 1 to 2 deliver a static web shell plus a **desktop helper** (the existing translator and a
pinned Emscripten) that turns the user's dump into a private bundle on the user's machine:

```text
user's RMCP01 dump
  → nodtool extract (existing)            → DATA/ tree
  → WiiCompiled translator (existing)     → generated C++ + data blobs
  → emcc/wasm-ld (new wasm target)        → mkw-private.wasm + .js + data
user drops bundle + DATA/ into the web page → stored in OPFS → plays
```

Nothing is uploaded; the public site contains only runtime, Aurora, shell and tooling. This keeps
WiiCompiled's provenance model unchanged. Browser-only setup (translate in the page) is a Phase 3
decision gated on measurements: in-browser C++ compilation (Option A) versus a wasm backend in
the translator (Option B). Pre-generated "metadata" distribution is rejected without legal review.

### D2. wasm32, checked guest memory, no memory64

Adopt the fork's `MKW_CHECKED_GUEST_MEMORY` compact backing: MEM1 and MEM2 as plain buffers,
mirrors through the existing 1 MiB page table, MMIO/EFB/executable-write policy via the existing
checked helpers. No fixed addresses, no fault handlers. Budget 512 MiB initial, growth to 2 GiB.

### D3. Guest on one browser thread; stack switching via Emscripten fibers first, JSPI later

Keep the cooperative scheduler unchanged. Implement `HostContext` for `__EMSCRIPTEN__` with
`emscripten_fiber_*` (Asyncify mode 1). Make the two blocking wait points (`VI_HLE_WaitForNextRetracePoll`,
`PaceToRetraceBoundary`) and the other host sleeps yield to the event loop, so a
`requestAnimationFrame` tick runs the guest until it blocks on the next retrace. Simulation stays
at the VI cadence from wall clock; presentation is per rAF; interpolation slots are presented on
successive rAF ticks instead of timed sleeps.

The translator will emit `ASYNCIFY_REMOVE`/`ASYNCIFY_ADD` lists (state-free leaves, non-yielding
HLE) to limit instrumentation. If measured overhead is unacceptable, the fallback is a custom
JSPI-based symmetric fiber scheme with explicit `__stack_pointer` management, or `-sPROXY_TO_PTHREAD`
with the guest on a worker and Asyncify fibers inside it. pthreads are not used for guest threads:
one pthread per guest thread breaks `thread_local` assumptions and WebGPU realm affinity.

### D4. Graphics: re-apply melee-pc's Aurora Emscripten patch to WiiCompiled's `aurora-main` fork

Keep `MKW GX → WiiCompiled GX HLE → aurora-main GX → browser WebGPU`. Port commit `64b4642`
(emdawnwebgpu provider, no `WEBGPU_DAWN`, canvas surface, inline GX processing, `WriteBuffer`
staging, async pipelines, cooperative completions) onto the fork, and additionally force the
fork's frame worker, presenter and interpolation pool to their inline paths. Hold C++ references in
the bind-group cache (dusk-wasm fix). WebGL2 is out of scope.

### D5. Audio and input through SDL3's Emscripten backends

The runtime already pushes PCM into an SDL3 audio stream and reads pads through Aurora/SDL3.
Use SDL3's Emscripten audio and gamepad backends first; instrument underruns and latency; write a
custom AudioWorklet or Gamepad adapter only if measurements require it. Wii Remote/KPAD is
disabled; a GameCube mapping drives menus and races.

### D6. Storage

OPFS for the private bundle, extracted `DATA/` tree and pipeline cache; IDBFS or an OPFS-backed
VFS for NAND (saves, `setting.txt`, Mii data) and config. Web Locks to serialize two tabs. Explicit
save export/import and "Clear Local Game Data". Request persistent storage.

### D7. Disc access

Phase 1: the extracted `DATA/` tree in OPFS, read synchronously from a worker via OPFS sync access
handles, or via a suspended read from the main thread, behind a `DiscReader`-style seam in the DVD
HLE. Phase 3: nod compiled to wasm for in-browser partition decryption and selective extraction.

### D8. Networking

Ship an explicit offline adapter (`NetworkEnabled(false)` path) first. The future swap point is the
`NativeSocket` helper layer in `hle/net`, shimmed so TCP maps to a WebSocket/WebTransport gateway
and UDP peer traffic to WebRTC data channels; TLS stays in wasm (mbedTLS over the proxied stream).
Retro-WFC and Retro Rewind are not Phase 1 requirements.

### D9. Contribution shape

- Aurora: coordinate with the melee-pc author to upstream the Emscripten patch into
  encounter/aurora; apply the same patch to `aurora-main` in WiiCompiled.
- WiiCompiled: contribute to or merge with OtherShindo957/WiicompiledWeb rather than start a third
  fork; ask upstream (issue #124 thread) whether a `platform/web` target is welcome.
- This repo: thin shell, build tooling, desktop helper, docs, spikes. GPLv3 (required by
  WiiCompiled's licence).

## Alternatives considered

- **Translate in-browser from day one.** Rejected for Phase 1: .NET + clang in wasm, hundreds of MB
  of C++, 2 GB per shard; not a port problem. Revisit in Phase 3 with measurements.
- **Emit a wasm module directly from the translator (IR → wasm).** Strongest long-term path to
  browser-only setup; a compiler project (structured control flow, dispatch tables, FP fidelity,
  suspension points). Deferred to Phase 3.
- **pthreads per guest thread.** Rejected (thread_local, WebGPU realm, SDL main-thread affinity).
- **WebGL2 fallback.** Rejected for now; would mean a new GX renderer.
- **Hosting translated bundles.** Rejected on legal and upstream-policy grounds.

## Consequences

- First playable browser build requires a desktop step. The brief's "visit a website and select a
  disc" flow is a Phase 3 outcome, not Phase 1.
- Asyncify cost on a 28k-function module is the main technical risk; it is measured early
  (Milestone 1b) and has two fallbacks.
- Floating-point: FTZ on intermediates is lost and NaN payloads differ; validated with ghost
  replays before claiming physics parity.
- Chrome/Edge with WebGPU only, until JSPI and WebGPU ship broadly elsewhere.

## Amendment (2026-11-09)

"It can never be hosted" above was this project's policy, not a technical fact, and the owner
changed it on 2026-11-09: the build is hosted at a public address, as the N64 and Xbox 360
static-recompilation projects publish theirs (README, "Legal"; docs/hosting.md). The translated
output still embeds the game's data sections; emitting them as files loaded from the player's own
disc at run time would put the hosted build on the same footing as those projects, and is the
natural next change to the translator branch.
