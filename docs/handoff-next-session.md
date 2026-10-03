# Handoff prompt: private self-hosted release (paste into a new session)

Use a workflow to orchestrate this. Run it from `/home/mukul/code/mkwii-webgpu`.

## Where things stand (2026-10-02)

Mario Kart Wii runs in Chrome from a build made on this machine. Read these first, in order:
`docs/plan.md` (Part 1b), `docs/research-browser-port.md` (sections 2, 6b, 6c),
`docs/adr/0001-browser-architecture.md` (Amendment), `work/Wiicompiled/docs/web-regions.md`,
`work/mariokartwebtest/CLAUDE.md` and `HANDOVER.md`, `spikes/disc-wasm/README.md`,
`tools/browser-test/README.md`.

- **Fork:** `work/Wiicompiled` (its own git repo), branch `athena-web-ntsc` = Minithena's `web`
  branch (working Emscripten/WebGPU/JSPI port) + upstream PR patchzyy/Wiicompiled#247
  (NTSC-U/J/K region tables) + our fixes. Remotes: `origin` upstream, `minithena`, `darth`,
  `shindo`. Nothing is pushed anywhere.
- **Tooling:** `work/mariokartwebtest` (Minithena's page tooling; `wiicompiled` is a symlink to
  our fork). `scripts/build-private-bundle.sh` runs extract, translate, emcmake build and stage.
- **Disc:** the user's clean NTSC-U dump (`RMCE01`) is in `game/`; extracted data is in
  `work/Wiicompiled/Assets`, translator output in `work/Wiicompiled/generated`, web build in
  `work/Wiicompiled/build-web`, staged site in `work/mariokartwebtest/site/public`.
- **Verified:** boots to title at 60 FPS; a Grand Prix race runs with catch-up and race-asset
  prefetch hooks active (RTX 4090, Google Chrome 154 with WebGPU flags).
- **Toolchain:** Emscripten 6.0.11 `~/tools/emsdk` (`source emsdk_env.sh`), .NET 8
  `~/tools/dotnet`, ninja/nodtool/clang symlinks in `~/tools/bin` (put it first on PATH; the
  `~/.local/bin/ninja` shim is broken), Rust stable with `wasm32-unknown-unknown`, Node 24.
  No sudo. Native SDL3 needs `-DSDL_X11_XSCRNSAVER=OFF`.
- **Testing:** the built-in browser pane has no WebGPU adapter. Use `tools/browser-test`
  (Playwright driving `/usr/bin/google-chrome` on `DISPLAY=:0`). Only one Chrome test should
  hold the GPU/display at a time.

## Goal

A private, self-hosted release: the owner builds the bundle once from their own disc, hosts the
page behind access control for themselves and friends who own the game, and each player supplies
their own disc image in the page (read locally, never uploaded).

## Hard rules

- Never commit, upload, paste or log anything derived from the game: disc images, `Assets/`,
  `generated/`, `build-*/`, `*.wasm`, the staged `site/`, screenshots of the game in git.
  Check `git status` before every commit.
- No `git push`, no deployment, no account or DNS changes, and no posting issues or PRs without
  the user's explicit approval in chat. Prepare everything up to that point and stop.
- Keep web changes in `runtime/src/platform/web/` or behind `__EMSCRIPTEN__`; native Linux
  (`build-native`) must keep building. New guest addresses go through `MKW_GADDR` identities and
  `tools/region` with evidence, never raw addresses.
- Upstream contribution rules: one change per commit, human-explainable, hardware-identical
  behaviour for anything touching the game.
- Verify before reporting: a claim that something works needs a console line or screenshot from
  a real Chrome run.

## Step 0 (sequential, before any fan-out)

The build currently assumes one fork checkout, one build dir, one staged site and port 8000.
Make it parallel-safe first:

1. Commit the outer repo's current files (docs, scripts, spikes, tools) on `main`, add a GPLv3
   `LICENSE`. Do not add `work/`, `upstream/`, `game/`.
2. Parametrize `scripts/build-private-bundle.sh` and Minithena's `tools/stage-web.sh` by
   environment: `FORK` (checkout), `BUILD_DIR`, `SITE_DIR`, `PORT`. Default values keep today's
   behaviour.
3. Add `scripts/new-track.sh <name>`: creates `work/wt-<name>` as a git worktree of
   `work/Wiicompiled` on branch `track/<name>` from `athena-web-ntsc`, symlinks `Assets` and
   `generated` from the main checkout (they are gitignored and identical for every track),
   and prints the `BUILD_DIR`, `SITE_DIR` and `PORT` for that track.
4. Confirm a clean rebuild + stage + `boot-test.js` pass on the main checkout as the baseline.

## Phase 1 (concurrent; one agent per track, each in its own worktree, build dir, site dir, port)

Give each agent `-j6` for builds so five builds fit on 24 cores, and have them take a lock
file (`/tmp/mkw-chrome.lock`, `flock`) around Chrome test runs.

- **Track A, local disc (M3).** Turn `spikes/disc-wasm` into the product path. A worker opens
  the picked `File` with the nod wasm (`FileReaderSync`), validates the game ID and the DOL/REL
  hashes against the region manifests, and serves `/game/DATA/...` to the runtime. Implement the
  lazy design first (a WASMFS backend JS half modelled on `mkw_fetchfs.js`, bounded chunk cache,
  keep the prefetch API working); persist the file handle in IndexedDB where the browser allows
  and fall back to re-picking. Page UI: disc picker, status line, "Clear local game data".
  The fetch-backed mount stays available behind a query flag for the owner's staged setup.
  Files: new `runtime/src/platform/web/mkw_discfs.js` + worker, `web_platform.cpp` mount,
  `shell.html`, `runtime/cmake/PublicProducts.cmake` link flags, a `disc-wasm` crate under
  `runtime/src/platform/web/` or `tools/`. Acceptance: boot and a race from the WBFS picked in
  the page with `site/public/game/DATA` absent; Node tests for the backend like
  `mkw_fetchfs.test.mjs`.
- **Track B, display-tied presentation.** Minithena's known issue 2: the game paces on its own
  VI wall clock, so 120/144 Hz and 59.94 Hz displays judder. Tie presentation to the browser's
  frame callback while the simulation stays at the VI cadence. Files: `runtime/src/hle/vi.cpp`,
  `platform/web/web_pacing.h`, `web_guest_hooks.cpp`, aurora present path. Acceptance:
  `[web-pace]` shows 60 steps/s with even frame intervals at 60 Hz, and at an emulated or real
  higher refresh; no regression in the Grand Prix drive test. Does not touch `shell.html` or
  `web_platform.cpp`.
- **Track C, hosting.** In `work/mariokartwebtest` (own git repo): produce two documented,
  scripted ways to self-host privately, both sending COOP/COEP/CORP and range requests:
  (1) Cloudflare Worker + R2 behind Cloudflare Access, adapting Minithena's `tools/cloudflare`
  and `deploy-web.py`; (2) a single-machine option (Caddy or nginx config with basic auth or
  Tailscale-only binding). With Track A the server no longer needs the game folder, only
  `WiiCompiled.{html,js,wasm,data}`; make both flows work with and without `game/`. Stop before
  any real deploy: output the exact commands and what credentials the user must supply.
- **Track D, repo and CI.** Outer repo and fork hygiene: `README.md` for the outer repo
  (what this is, the rules, quick start on Linux), a CI workflow file that runs only game-free
  checks (translator tests, wasm unit tests via `emcmake` with `MKW_BUILD_PRODUCTS=OFF`,
  `spikes/disc-wasm` build, Node tests), pinned tool versions in one place, and
  `scripts/doctor.sh` that checks the toolchain. Draft (do not post) notes for the user to write
  an issue to Minithena/mariokartwebtest and a comment on patchzyy/Wiicompiled#247 offering the
  ELF blob fix, the NAND test fix, the porter fix and the web-region work.
- **Track E, native NTSC-U build and parity harness.** Build the native Linux product from the
  same `generated/` (`build-native`, products ON) and run it; then build the comparison harness:
  Minithena proved physics parity on PAL by replaying a native ghost in the web build. Prepare
  the same for NTSC-U: script the steps, automate what can be automated with
  `tools/browser-test/drive.js`, and leave a short checklist for the one step that needs a human
  (recording a time-trial ghost). Report whether native boots and plays on this machine.

Each agent reports: commits on its branch, files touched, test evidence, anything unverified.

## Phase 2 (sequential, on `athena-web-ntsc`)

1. Merge `track/b` (pacing), rebuild, run boot + Grand Prix drive test. Fix or revert.
2. Merge `track/a` (local disc), resolve `shell.html`/`web_platform.cpp` conflicts, rebuild, run
   the drive test from a picked disc.
3. **Saves UI** (done here because it edits `shell.html` after Track A): export, import and
   backup of `rksys.dat` and settings from OPFS, a Web Lock so two tabs cannot clobber a save,
   and a storage-persistence request. Test export then import in a fresh profile.
4. **Controllers:** verify gamepad input through SDL with a virtual gamepad if one can be
   created without sudo, otherwise leave a human checklist; document keyboard and pad bindings.
5. Full regression: clean rebuild from scratch with `scripts/build-private-bundle.sh`, boot test,
   Grand Prix drive test, native build still compiles, all wasm and Node tests pass.
6. Stage a release directory using Track C's script (no deploy) and write
   `docs/release-checklist.md`: the human test matrix (second machine, integrated GPU, Windows,
   macOS, 144 Hz, four pads, two-machine online room), known issues, and how friends get access.
7. Final report to the user: what is merged, what is verified by which evidence, what needs
   their approval (push to their GitHub forks, deploy, upstream messages) and what needs a human.

## Out of scope for this handoff

In-browser translation (public site), WebRTC, Retro Rewind, Safari, WebGL.
