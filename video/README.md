# Demo video

A short, plain demo of the game running in a browser (Chrome, or Portal), assembled with
[Remotion](https://www.remotion.dev) from recordings of the real thing: a browser window on this
machine, driven by the browser-test scripts, recorded with ffmpeg. About 26 s at 1080p60, with
Wii Menu styled cards: a title card, the title screen, the start of a Grand Prix race with the HUD
and the page's own frame-rate readings, two browser windows in one online race (about 13 s in), and a
closing card.

**Captures and renders show the game and never go into git.** `video/public/captures/` and
`video/out/` are gitignored (`.gitignore` at the repository root); keep it that way, and check
`git status` before committing anything under `video/`. What is committed is only the pipeline:
the capture script, the routes, the compositions and this file.

## 1. Capture

Needs: the staged site with the game folder (`work/sites/release-game/public`, from
`scripts/build-private-bundle.sh`), the browser-test dependencies
(`cd tools/browser-test && npm install`), Google Chrome, ffmpeg, `xdotool`, and an X display at
`:0` (on a Wayland desktop that is Xwayland; Chrome is opened as an X11 window so it can be
recorded). Nothing else may use the GPU display at the same time: the script takes
`/tmp/mkw-chrome.lock` like the other browser tests. The Chrome window appears on your desktop for
the length of the route; leave it alone while it records.

```bash
tools/video/capture.sh boot     # page load, Start, shader compile, title screen, opening movie (~45 s)
tools/video/capture.sh gp         # the same, then a 50cc Grand Prix race driven by the bot (~2.5 min)
tools/video/capture.sh timetrial  # the same, then a Time Trial on the staff ghost's inputs   (~3 min)
tools/video/capture.sh race     # the same, then a 50cc Grand Prix race driven by the script   (~4 min)
```

The demo's gameplay segment uses `gp` when there is one: the first race of a 50cc Grand Prix
(Luigi Circuit, 12 karts, items) driven by a small bot, `tools/browser-test/kart-bot.js`. It plays
like a person at a controller: every frame it reads the kart's position and heading and the
course's CPU route from the game's memory, steers towards a route point a little ahead, holds
accelerate and fires whatever item it has every few seconds, all through a fake gamepad on port 1.
The game sees an ordinary player, so the race keeps the chase camera, the HUD and normal online
play. (Marking the player's kart as a CPU instead gave the game's spectator camera, and online the
host's kart never moved.)

Without `gp` it uses `timetrial`: a Time Trial on Luigi Circuit whose player kart is
driven by the disc's staff ghost's recorded inputs, a TAS that needs no special build. The route
picks "Race This Ghost", and on the Start Race screen the page's `autodrive('ghost')`
(`tools/browser-test/guest-memory.js`) turns player 0 of the game's race setup into the ghost and
removes the ghost kart, so the game itself reads the ghost's inputs for the player, frame by frame
from the race's first frame, with the normal camera and HUD. The capture finishes in 1:29.670, the
ghost's own time, with the chase camera, but alone on the track: recorded inputs cannot survive
other karts. ("Watch the Replay" plays the same inputs but without the HUD, with the ghost's name
over the kart.) With neither, the segment falls back to `race`, the scripted keyboard drive.

**A seeded save.** Every run starts from a fresh browser profile, so without help the game makes a
new licence and Mii each time. Stage the site's game folder with a save instead
(`tools/hosting/stage-game.sh --save rksys.dat <game dir>`; any run's save will do: the page's
Export save button downloads it). The `gp` and `timetrial` routes need it (it goes title -> licence 1 -> main
menu), and `multiplayer` uses it when it is there (room-test.js `MKW_LICENCE=0`, set by
capture.sh). Routes count presses, so a press too many or too few puts the D-pad presses on the
wrong screens; `demo-timetrial.cmds` anchors on the game's title-scene console line (`waitlog`)
rather than on time since Start, and takes a screenshot after each D-pad press to check against.

**Portal instead of Chrome.** `MKW_BROWSER=portal` records the Portal dev build (`~/code/browser`
on `~/code/portal-chromium`; `PORTAL_BROWSER_REPO`, `PORTAL_CHROMIUM_ROOT` and `PORTAL_EXE`
override the paths) with Portal's own chrome around the page, on a fresh profile whose
onboarding the drivers release through Portal's probe bridge. The build, the repo's vendored
mojom bindings and the `dist-portal` bundle have to agree (Portal's `02-build.sh`,
`export-mojom-bindings.sh`, then `vite build --config src/chrome/vite.config.ts`); a white
window or a "portal.mojom hash mismatch" page means they do not. The packaged `portal-browser`
cannot be driven: it drops the debugging port. `meta.json` records the browser, and the title
captions name it.

Each run writes `video/public/captures/<name>/` (multiplayer: `<name>/a/` and `<name>/b/`):

| File | What |
|---|---|
| `capture.mp4` | the Chrome window, 60 fps H.264 (NVENC when there is an NVIDIA GPU, else libx264) |
| `console.log` | the page's console, with the driver's marks (`[driver] mark …`) |
| `meta.json` | window geometry, ffmpeg's start time, length |
| `perf.json` | from `scripts/perf-to-json.mjs`: every `[web-perf] fps=` sample and every mark, on the video's clock |

`tools/video/capture.sh <name> <route.cmds> [max-seconds]` records any route written for
`tools/browser-test/pace-drive.js` (see `tools/browser-test/README.md`); the two demo routes are
`tools/browser-test/routes/demo-boot.cmds`, `demo-gp.cmds`, `demo-timetrial.cmds` and
`demo-race.cmds`. A route ends with `mark end`;
`mark <name>` lines become cut points the compositions can use. `MKW_SITE`, `MKW_PORT` and
`MKW_DISC` (a disc image for a site without a game folder) are honoured, as in the browser tests.

The fps overlay in the video is driven by the page's own `[web-perf] fps=` console lines, three
seconds apart, matched to the recording by the driver's and ffmpeg's start times (within a few
hundred milliseconds). Nothing in the overlay is typed in by hand. To regenerate `perf.json`
after editing the script:

```bash
node video/scripts/perf-to-json.mjs video/public/captures/race
```

### Multiplayer

```bash
tools/video/capture.sh multiplayer      # two clients in one race through the relay (~4 min)
```

This runs `tools/browser-test/room-test.js` in windowed mode: two Chrome profiles side by side
on the display, each half the work area; client A creates a room on the relay
(`tools/relay/dev-local.sh`, started on 127.0.0.1:8787 if nothing answers there), B joins with
the code, both press Play online and reach the same race, where the bot drives both karts
(`MKW_BOT=1`, the default; `MKW_BOT=0` for the old fixed keyboard drive, which only holds accelerate
and taps left and right). In Portal the two windows get
differently coloured spaces, red (A) and green (B) by default (`MKW_SPACE_THEME_A` / `_B`:
`#rrggbb[,strength[,grain]]`; `MKW_SPACE_THEME` does the same for a single-window route). The
staged site has to carry the
fork's room fixes (`athena-web-ntsc` at 7b68518 or later; a staging from before it stops at
"Your saved profile needs attention"), so point `MKW_SITE` at a current staging, for example
`MKW_SITE=work/sites/relay-test/public`. Each window is recorded on its own:
`video/public/captures/multiplayer/a/` and `/b/` hold a `capture.mp4`, `console.log`,
`meta.json` and `perf.json` each, with the same marks in both (`lobby`, `play`, `race-loaded`,
`go`, `end`). `perf.json` also carries the `[vnet]` and `[room-launch]` console lines as
`events`; the segment shows each client's latest one over its half of the picture. The
`Multiplayer` composition plays the lobby (both names in the roster) and then the start of the
race from both windows; with no capture it shows a placeholder card instead.

## 2. Preview and render

```bash
cd video && npm install
npx remotion studio                       # preview; compositions Main, Boot, Gameplay, Multiplayer
npx remotion render Main out/demo.mp4     # 1080p60 H.264 to video/out/ (gitignored)
```

The compositions read the captures when opened or rendered and take their lengths from the marks,
so `Main` is about 26 s with the four captures and placeholders where a capture is missing. Frames
are rendered by the installed Google Chrome (`REMOTION_BROWSER` points at another browser;
`REMOTION_BROWSER=` empty lets Remotion download its own headless shell). The typeface, Nunito,
comes from Google Fonts at render time, so rendering needs network access for that one request.

Versions are pinned exactly in `package.json` (Remotion 4.0.539, React 19.3.1).

## Layout

| Path | What |
|---|---|
| `src/Root.tsx` | the compositions and how each loads its capture |
| `src/Main.tsx` | the demo's order: title, intro (boot), gameplay (gp, else timetrial, else race), multiplayer, closing |
| `src/timeline.ts` | where each clip cuts into the captures (seconds, from the marks) |
| `src/Boot.tsx`, `src/Gameplay.tsx`, `src/Multiplayer.tsx` | the three segments |
| `src/Clip.tsx`, `src/FpsOverlay.tsx`, `src/Cards.tsx` | a capture window with caption and fps overlay; the cards |
| `src/captures.ts` | capture metadata types and loading |
| `scripts/perf-to-json.mjs` | console.log + meta.json → perf.json |
| `public/captures/` (gitignored) | the recordings |
| `out/` (gitignored) | renders |
