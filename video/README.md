# Demo video

A short, plain demo of the game running in Chrome, assembled with [Remotion](https://www.remotion.dev)
from recordings of the real thing: a Chrome tab on this machine, driven by the browser-test
scripts, recorded with ffmpeg. About a minute at 1080p60: a title card, the page booting the game,
a Grand Prix race with the page's own frame-rate readings, a slot for online multiplayer, and a
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
tools/video/capture.sh boot     # page load, Start, shader compile, title screen        (~45 s)
tools/video/capture.sh race     # the same, then the menus and a 50cc Grand Prix race  (~4.5 min)
```

Each run writes `video/public/captures/<name>/`:

| File | What |
|---|---|
| `capture.mp4` | the Chrome window, 60 fps H.264 (NVENC when there is an NVIDIA GPU, else libx264) |
| `console.log` | the page's console, with the driver's marks (`[driver] mark …`) |
| `meta.json` | window geometry, ffmpeg's start time, length |
| `perf.json` | from `scripts/perf-to-json.mjs`: every `[web-perf] fps=` sample and every mark, on the video's clock |

`tools/video/capture.sh <name> <route.cmds> [max-seconds]` records any route written for
`tools/browser-test/pace-drive.js` (see `tools/browser-test/README.md`); the two demo routes are
`tools/browser-test/routes/demo-boot.cmds` and `demo-race.cmds`. A route ends with `mark end`;
`mark <name>` lines become cut points the compositions can use. `MKW_SITE`, `MKW_PORT` and
`MKW_DISC` (a disc image for a site without a game folder) are honoured, as in the browser tests.

The fps overlay in the video is driven by the page's own `[web-perf] fps=` console lines, three
seconds apart, matched to the recording by the driver's and ffmpeg's start times (within a few
hundred milliseconds). Nothing in the overlay is typed in by hand. To regenerate `perf.json`
after editing the script:

```bash
node video/scripts/perf-to-json.mjs video/public/captures/race
```

### The multiplayer slot

The `Multiplayer` composition plays `video/public/captures/multiplayer/` when it exists and shows
a placeholder card otherwise. Record it the same way once a route for two browsers in one race
through the relay exists:

```bash
tools/video/capture.sh multiplayer tools/browser-test/routes/<that route>.cmds 400
```

The clip is cut from the route's `go` mark (or the first race-pace console line) like the
Grand Prix clip, so the route should `mark go` where the countdown ends.

## 2. Preview and render

```bash
cd video && npm install
npx remotion studio                       # preview; compositions Main, Boot, Gameplay, Multiplayer
npx remotion render Main out/demo.mp4     # 1080p60 H.264 to video/out/ (gitignored)
```

The compositions read the captures when opened or rendered and take their lengths from the marks,
so `Main` is about 60 s with the two captures and placeholders where a capture is missing. Frames
are rendered by the installed Google Chrome (`REMOTION_BROWSER` points at another browser;
`REMOTION_BROWSER=` empty lets Remotion download its own headless shell). The typeface, Inter,
comes from Google Fonts at render time, so rendering needs network access for that one request.

Versions are pinned exactly in `package.json` (Remotion 4.0.539, React 19.3.1).

## Layout

| Path | What |
|---|---|
| `src/Root.tsx` | the compositions and how each loads its capture |
| `src/Main.tsx` | the demo's order: title, boot, Grand Prix card, gameplay, multiplayer, closing |
| `src/timeline.ts` | where each clip cuts into the captures (seconds, from the marks) |
| `src/Boot.tsx`, `src/Gameplay.tsx`, `src/Multiplayer.tsx` | the three segments |
| `src/Clip.tsx`, `src/FpsOverlay.tsx`, `src/Cards.tsx` | a capture window with caption and fps overlay; the cards |
| `src/captures.ts` | capture metadata types and loading |
| `scripts/perf-to-json.mjs` | console.log + meta.json → perf.json |
| `public/captures/` (gitignored) | the recordings |
| `out/` (gitignored) | renders |
