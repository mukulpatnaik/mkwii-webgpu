# Mario Kart Wii in the browser

Mario Kart Wii running in Chrome, from the player's own disc, on
[WiiCompiled](https://github.com/patchzyy/Wiicompiled)'s static recompilation: the game's PowerPC
code is translated to C++ ahead of time and compiled with Emscripten to WebAssembly, rendered
through aurora on WebGPU, with guest threads as JSPI coroutines. No emulator, no JIT.

The browser port itself is Minithena's `web` branch of WiiCompiled. This project adds NTSC-U/J/K
support (DarthMDev's region work, since superseded upstream by patchzyy/Wiicompiled#326), and the
pieces a private release needs: players pick their own disc image in the page (read locally,
never uploaded), presentation tied to the display's refresh, a saves panel (export, import,
backup), keyboard and pad bindings including pads the browser cannot map, a native-vs-web parity
harness, and private hosting. State and evidence: [docs/release-checklist.md](docs/release-checklist.md).

## Rules

- **Nothing derived from the game goes into git, ever:** no disc images, no extracted files, no
  translated C++, no `.wasm`/`.data` of the game build, no staged site, no screenshots of the
  game. `.gitignore` covers the usual paths; check `git status` before every commit.
- **The built `.wasm` contains translated game code.** It is hosted privately, for people who own
  the game, and never shared publicly. Each player supplies their own disc image in the page.
- **Nothing is pushed, deployed or posted upstream without the owner's say-so.** The scripts stop
  before any real deploy and print what to run.
- Web changes live in `runtime/src/platform/web/` or behind `__EMSCRIPTEN__`; the native Linux
  build must keep building. Guest addresses go through region identities (`MKW_GADDR`), never raw.

## Layout

| Path | What |
|---|---|
| `docs/` | Plan and critique ([plan.md](docs/plan.md)), research ([research-browser-port.md](docs/research-browser-port.md)), ADR, [release checklist](docs/release-checklist.md), [controls](docs/controls.md), [parity harness](docs/parity-ntsc-u.md), [hosting](docs/hosting.md), [upstream drafts](docs/upstream-drafts.md) |
| `scripts/` | `doctor.sh` (toolchain check), `versions.env` (pinned versions), `build-private-bundle.sh` (disc → web build → staged site), `build-web-server.sh`, `new-track.sh` (parallel worktrees), `clone-upstream.sh`, `parity/` |
| `tools/browser-test/` | Playwright drivers for the real Chrome on the X display: boot, Grand Prix drive, pacing trace, saves, pads |
| `tools/web-server/` | `mkw-web`: a one-file local server that embeds the page files and offers your disc to the page |
| `tools/hosting/` | Private hosting: Cloudflare Worker + R2 behind Access, or a single machine with Caddy/nginx or Tailscale |
| `spikes/` | `disc-wasm` (nod for wasm32, now the product's disc reader in the fork) and `wasm-lean-runtime` |
| `work/` (gitignored) | `Wiicompiled`: the fork, branch `athena-web-ntsc`; `mariokartwebtest`: Minithena's page tooling (staging, Cloudflare, room relay); builds, staged sites, release directories |
| `upstream/` (gitignored) | Read-only clones of the repositories studied, pinned by `scripts/clone-upstream.sh` |
| `game/` (gitignored) | Your disc image and extraction scratch |

The two working repositories are their own git repositories, backed up privately:
`work/Wiicompiled` is [mukulpatnaik/mkwii-webgpu-wiicompiled](https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled)
(branch `athena-web-ntsc`; `minithena-web` keeps the upstream web branch) and `work/mariokartwebtest`
is [mukulpatnaik/mkwii-webgpu-webtest](https://github.com/mukulpatnaik/mkwii-webgpu-webtest).
Minithena's original `mariokartwebtest` repository disappeared from GitHub on or before 2026-10-28;
their WiiCompiled fork (`Minithena/Wiicompiled`, branch `web`) is still up.

## Quick start (Linux)

Tested on Ubuntu 26.04 with an RTX 4090 and Google Chrome 156. Toolchain pins are in
[scripts/versions.env](scripts/versions.env); the native build also needs the SDL development
packages listed there. Everything installs under `~/tools` without sudo (Emscripten, .NET 8, a
`bin/` with ninja, clang and nodtool) plus Rust with the `wasm32-unknown-unknown` target and Node 24.

```bash
git clone https://github.com/mukulpatnaik/mkwii-webgpu.git && cd mkwii-webgpu
git clone -b athena-web-ntsc https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled.git work/Wiicompiled
git clone https://github.com/mukulpatnaik/mkwii-webgpu-webtest.git work/mariokartwebtest
ln -sfn ../Wiicompiled work/mariokartwebtest/wiicompiled
scripts/doctor.sh                       # what is missing, and where the private data stands
```

Build the private bundle from your own clean retail dump (NTSC-U `RMCE01` here; PAL, NTSC-J and
NTSC-K translate the same way) and play on this machine:

```bash
scripts/build-private-bundle.sh /path/to/your/RMCE01.wbfs    # extract, translate, Emscripten build, stage (~15 min first time)
scripts/build-web-server.sh                                  # work/dist/mkw-web-linux-x86_64
work/dist/mkw-web-linux-x86_64 /path/to/your/RMCE01.wbfs     # serves 127.0.0.1:8010 and opens Chrome
```

Or serve the staged folder with the tooling's server and pick the disc in the page:
`python3 work/mariokartwebtest/tools/serve.py work/mariokartwebtest/site/public` then
`http://127.0.0.1:8000/WiiCompiled.html`. The built-in browser pane has no WebGPU; tests drive the
installed Chrome on the X display (`tools/browser-test/README.md`).

Hosting for friends who own the game: [docs/hosting.md](docs/hosting.md). Controls:
[docs/controls.md](docs/controls.md). Native build and parity: [docs/parity-ntsc-u.md](docs/parity-ntsc-u.md).

## Checks

`.github/workflows/checks.yml` lints the scripts and builds the disc-reader spike; the fork's
`.github/workflows/web-checks.yml` runs the translator tests, the runtime unit tests compiled to
wasm (`MKW_BUILD_PRODUCTS=OFF`) and the Node tests. Neither needs game data. The game-level
regression (boot, Grand Prix drive, saves, pads, parity) only runs on a machine with the disc:
see the release checklist.

## Licence

GPLv3 ([LICENSE](LICENSE)), like WiiCompiled. Minithena's room relay in the tooling is AGPL-3.0.
Nintendo's game, code and assets are not part of this project and are not licensed by it.
