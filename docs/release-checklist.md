# Private release checklist

State on 2026-10-03, fork `work/Wiicompiled` branch `athena-web-ntsc` (Minithena's `web` + NTSC
region support + this project's work). Nothing is pushed or deployed.

## What a release is

The owner builds once from their own disc and hosts **six files**, none of which contain the disc's
files (the private `.wasm` does contain translated game code, so it is still private: never host it
publicly, never share it beyond people who own the game):

```text
WiiCompiled.html  WiiCompiled.js  WiiCompiled.wasm  WiiCompiled.data  mkw_disc.wasm  mkw_disc_worker.js
```

Each player opens the page and picks their own disc image (WBFS, ISO or CISO; RVZ/WIA/GCZ are
refused with a message). The page reads it locally in a worker and never uploads it. Without a
`game/` folder on the server the page uses the local disc; with a staged `game/` folder
(`tools/stage-web.sh`) it streams that instead (`?disc=local` / `?disc=fetch` force either).

Build and stage a release directory:

```bash
scripts/build-private-bundle.sh /path/to/your/RMCx01.wbfs     # or --skip-extract --skip-translate
mkdir -p work/sites/release/public
cp work/Wiicompiled/build-web/{WiiCompiled.html,WiiCompiled.js,WiiCompiled.wasm,WiiCompiled.data,mkw_disc.wasm,mkw_disc_worker.js} work/sites/release/public/
python3 work/mariokartwebtest/tools/serve.py work/sites/release/public --port 8010   # local check
```

The host must send `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: same-origin`, and
`application/wasm` for `.wasm`. It must be behind access control. Scripted hosting (Cloudflare
Access, or Caddy/nginx with auth or Tailscale) is the deferred Track C; until then there is no
supported way to give friends access, only the local server above (127.0.0.1 only).

## Verified on this machine (RTX 4090, Chrome 154, Linux, 60 Hz display)

| What | Evidence (gitignored logs under `tools/browser-test/out/`) |
|---|---|
| Clean web build + stage, native product build, from the same `generated/` | web 2m15s, native 1m40s, both exit 0 |
| Grand Prix race from a staged folder, mouse/keyboard | `regression/fetch-gp`: `race steps/s=60.0 drawn/s=60.0`, `fps=60.0`; Chrome trace 299 pushes / 300 vsyncs, `vsyncs with no new frame: 0, with 2+ new frames: 0` |
| Grand Prix race from a picked WBFS, no `game/` on the server | `regression/local-gp`: `[web-disc] opened RMCE01 (NTSC-U) ... main.dol ok, StaticR.rel ok`, `mounted 2012 game files ... from the local disc image`, `race steps/s=60.0`, `fps=60.0` |
| Menu videos at half frame rate in local-disc mode | `a-fix/fps-local2`: pre-race menu `fps=59.7`, same as staged |
| Saves: export, import into a fresh profile (same sha256), second tab refused, `persist()` requested | `saves/` (branch run) and `regression/saves` (merged build) |
| One pad alone drives menus and a race with default settings | `pad-fix/` (virtual uinput Xbox pad) |
| Native NTSC-U boots, plays, and a staff ghost finishes at the same timer value natively and on the web | `e/parity-native-top-web-bottom.png`; see `docs/parity-ntsc-u.md` |
| Unit tests | native ctest 6/7 (the failure is upstream's: `RuntimePlatform::ExecutableDirectory()` has no Linux branch), wasm ctest 6/6, Node 142/143 pass + 1 skipped |

## Human test matrix (not done)

- [ ] Second Linux machine, fresh clone, `scripts/build-private-bundle.sh` from scratch (also checks
      the first-build network fetches: mbedTLS, Aurora deps, nod via cargo).
- [ ] Integrated GPU (Intel/AMD iGPU) in Chrome: fps in a 12-kart race and in the menus.
- [ ] Windows, Chrome and Edge: boot, local disc pick, race, saves export/import.
- [ ] macOS, Chrome: same.
- [ ] Real 120/144 Hz display: even presentation (`[web-pace] present at display callback` and,
      ideally, a Chrome trace with `frame-trace.py`). Only emulated so far (`?rafhz=`).
- [ ] 59.94 Hz display: expect one repeated frame about every 16 s (VI runs at 60.0024 Hz by design).
- [ ] Four real pads at once: ports 1-4, a 4-player VS race, rumble, hot-plug.
- [ ] Two-machine online invite room (Minithena's relay; never tested on NTSC-U here).
- [ ] A friend's own disc (a different dump of the same release, and a PAL disc against an
      NTSC-U build: the page should refuse a mismatched release with a clear message).
- [ ] Input latency feel with display-tied presentation vs `?present=immediate`.
- [ ] Record a personal native time-trial ghost and replay it on the web (`docs/parity-ntsc-u.md`).

## Known issues

- **Latency:** display-tied presentation (default) hands a frame to the canvas 16.8-29 ms after its
  VI retrace instead of about 6.6 ms; it removes judder (0 missed vsyncs instead of 19-29 per 5 s).
  `?present=immediate` restores the old path.
- **Real high-refresh displays untested;** hidden-tab and background online rooms with the new
  pacing untested (Playwright cannot hide a tab).
- **F10 mouse clicks** land in the wrong place when the game area is not 16:9 (`object-fit` vs SDL
  mouse scaling). Keyboard play is unaffected.
- **Wii Remotes** do not work in the browser (no HIDAPI); GameCube-style pads and keyboard only.
- **Persistent storage** is often not granted by Chrome; the saves panel says so. Players should
  use "Export backup" now and then. Custom Mii data is not in the backup.
- **Local-disc mode** re-indexes the menu videos on every open (about 3 s, during boot) and keeps
  up to 256 MiB of disc cache in memory. Firefox/Safari cannot keep a file handle, so players
  re-pick the disc each visit.
- **First build needs network** (mbedTLS, Aurora's deps, nod for cargo); offline builds need
  `-DMKW_NOD_SOURCE_DIR=` pointing at a nod checkout.
- Upstream (not ours): `mkw_platform_paths_tests` fails on Linux.

## How friends get access

Not settled: needs Track C (hosting behind access control). Each friend must own the game and pick
their own disc image; the owner shares only the page URL and the access credential, never the
`.wasm` file or any game data.
