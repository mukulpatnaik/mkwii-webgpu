# Browser tests (real Chrome, real GPU)

The built-in browser pane has no WebGPU adapter, so tests drive `/usr/bin/google-chrome` on the
X display with Playwright (`playwright-core`, no browser download).

```bash
npm install
DISPLAY=:0 node boot-test.js "http://127.0.0.1:8000/WiiCompiled.html?muted" 120 out/boot
DISPLAY=:0 node drive.js     "http://127.0.0.1:8000/WiiCompiled.html?muted" out/drive   # then append commands to out/drive/cmds
```

Only one Chrome test may hold the GPU and display at a time. When several tracks run
(`scripts/new-track.sh`), wrap every run in the shared lock and use the track's port:

```bash
DISPLAY=:0 flock /tmp/mkw-chrome.lock node boot-test.js "http://127.0.0.1:$PORT/WiiCompiled.html?muted" 120 out/boot-$PORT
```

For functional tests (does it boot, does the race start, does a save round-trip) use a nested
display instead: it keeps the window off the desktop and needs no lock, so tests can run in
parallel. Chrome there still gets the real GPU, but presentation is copied in software (present
times about 12-18 ms instead of 5), so keep fps and pacing measurements on `:0` under the lock.
Headless Chrome gets no WebGPU adapter on this machine.

```bash
DISPLAY=$(./nested-display.sh 6) node boot-test.js "http://127.0.0.1:$PORT/WiiCompiled.html?muted" 120 out/boot-$PORT
```

`boot-test.js <url> <seconds> <outdir>`: clicks Start, screenshots every 10 s, writes `console.log`.
`drive.js <url> <outdir>`: polls `<outdir>/cmds`; commands are `click [x y]`, `key <Name> [holdMs]`,
`wait <ms>`, `shot <name>`, `eval <js>`, `quit`. Left click is A. The title drops into the attract
demo after a few seconds: click once to cancel it, then again on the settled title.

Healthy signals in `console.log`: `[web-perf] fps=60.0`, `[web-pace] race steps/s=60.0` in a race,
`[web-warm] 12 players ...` before a race loads. `out/` is gitignored (screenshots show the game).
