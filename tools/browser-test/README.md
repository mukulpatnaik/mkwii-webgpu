# Browser tests (real Chrome, real GPU)

The built-in browser pane has no WebGPU adapter, so tests drive `/usr/bin/google-chrome` on the
X display with Playwright (`playwright-core`, no browser download).

```bash
npm install
DISPLAY=:0 node boot-test.js "http://127.0.0.1:8000/WiiCompiled.html?muted" 120 out/boot
DISPLAY=:0 node drive.js     "http://127.0.0.1:8000/WiiCompiled.html?muted" out/drive   # then append commands to out/drive/cmds
```

`boot-test.js <url> <seconds> <outdir>`: clicks Start, screenshots every 10 s, writes `console.log`.
`drive.js <url> <outdir>`: polls `<outdir>/cmds`; commands are `click [x y]`, `key <Name> [holdMs]`,
`wait <ms>`, `shot <name>`, `eval <js>`, `quit`. Left click is A. The title drops into the attract
demo after a few seconds: click once to cancel it, then again on the settled title.

Healthy signals in `console.log`: `[web-perf] fps=60.0`, `[web-pace] race steps/s=60.0` in a race,
`[web-warm] 12 players ...` before a race loads. `out/` is gitignored (screenshots show the game).
