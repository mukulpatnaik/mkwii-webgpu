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
| `tools/relay/` | The room relay for online play: Minithena's Cloudflare Worker, vendored unchanged. **AGPL-3.0**, its own `LICENSE`; local run, tests, deploy command |
| `spikes/` | `disc-wasm` (nod for wasm32, now the product's disc reader in the fork) and `wasm-lean-runtime` |
| `work/` (gitignored) | `Wiicompiled`: the fork, branch `athena-web-ntsc`; builds, staged sites, release directories |
| `upstream/` (gitignored) | Read-only clones of the repositories studied, pinned by `scripts/clone-upstream.sh` |
| `game/` (gitignored) | Your disc image and extraction scratch |

The fork is its own git repository:
[mukulpatnaik/mkwii-webgpu-wiicompiled](https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled)
(branch `athena-web-ntsc`; `minithena-web` keeps Minithena's web branch as it was). Minithena's
separate page tooling (`Minithena/mariokartwebtest`: staging, a Cloudflare Worker, a room relay)
disappeared from GitHub on or before 2026-10-28. It carried no licence apart from its room
relay (`tools/cloudflare/rooms`, AGPL-3.0), which is here unchanged as `tools/relay/`; nothing
else of it is in this repository, and the pieces this project needs were written again under
`tools/hosting/`.
Their WiiCompiled fork (`Minithena/Wiicompiled`, branch `web`, GPLv3) is still up.

## Quick start (Linux)

Tested on Ubuntu 26.04 with an RTX 4090 and Google Chrome 156. Toolchain pins are in
[scripts/versions.env](scripts/versions.env); the native build also needs the SDL development
packages listed there. Everything installs under `~/tools` without sudo (Emscripten, .NET 8, a
`bin/` with ninja, clang and nodtool) plus Rust with the `wasm32-unknown-unknown` target and Node 24.

```bash
git clone https://github.com/mukulpatnaik/mkwii-webgpu.git && cd mkwii-webgpu
git clone -b athena-web-ntsc https://github.com/mukulpatnaik/mkwii-webgpu-wiicompiled.git work/Wiicompiled
scripts/doctor.sh                       # what is missing, and where the private data stands
```

Build the private bundle from your own clean retail dump (NTSC-U `RMCE01` here; PAL, NTSC-J and
NTSC-K translate the same way) and play on this machine:

```bash
scripts/build-private-bundle.sh /path/to/your/RMCE01.wbfs    # extract, translate, Emscripten build, stage (~15 min first time)
scripts/build-web-server.sh                                  # work/dist/mkw-web-linux-x86_64
work/dist/mkw-web-linux-x86_64 /path/to/your/RMCE01.wbfs     # serves 127.0.0.1:8010 and opens Chrome
```

Or serve the staged folder (`tools/hosting/serve.py work/sites/main/public`, then
`http://127.0.0.1:8000/WiiCompiled.html`): it streams the extracted disc, or the disc you pick in
the page with `?disc=local`. The built-in browser pane has no WebGPU; tests drive the installed
Chrome on the X display (`tools/browser-test/README.md`).

Hosting for friends who own the game: [docs/hosting.md](docs/hosting.md). Controls:
[docs/controls.md](docs/controls.md). Native build and parity: [docs/parity-ntsc-u.md](docs/parity-ntsc-u.md).

## Checks

`.github/workflows/checks.yml` lints the scripts, runs the page Worker's and the room relay's
unit tests and builds the disc-reader spike; the fork's
`.github/workflows/web-checks.yml` runs the translator tests, the runtime unit tests compiled to
wasm (`MKW_BUILD_PRODUCTS=OFF`) and the Node tests. Neither needs game data. The game-level
regression (boot, Grand Prix drive, saves, pads, parity) only runs on a machine with the disc:
see the release checklist.

## Legal

This repository holds tooling, scripts and documentation, and nothing from the game: no disc
images, no extracted files, no translated code, no builds. The browser build can only be made
from a disc you own, on your own machine (`scripts/build-private-bundle.sh`), and the result
contains the game's code in translated form. So:

- No builds are published here or anywhere else, and none will be. There are no GitHub Releases.
- A build you make is for you and for people who own the game, behind a login
  ([docs/hosting.md](docs/hosting.md)). Never put it on a public address.
- Players always supply their own disc image; the page reads it in their browser and uploads
  nothing.

Mario Kart Wii is Nintendo's. This project is not affiliated with or endorsed by Nintendo, and
nothing here grants any right to the game. See [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

## Licence

GPLv3 ([LICENSE](LICENSE)), like WiiCompiled. The fork's web branch contains work by Minithena
(Athena), DarthMDev, Rookie and others under the same licence; see its history.

The one exception is [`tools/relay/`](tools/relay/), the room relay for online play: Minithena's
Cloudflare Worker, vendored unchanged, under the **GNU Affero General Public License v3.0 only**
([tools/relay/LICENSE](tools/relay/LICENSE)). It is a separate program that runs as its own
service; the page only talks to it over WebSockets, and nothing of it is compiled into the game
page. Anyone who runs a modified relay for others must offer them its source, as the AGPL requires.
