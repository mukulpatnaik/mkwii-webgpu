# NTSC-U physics parity: native Linux vs web

Goal: show that the web build (WebAssembly, WebGPU) runs Mario Kart Wii's physics exactly like
the native build of the same translation (`generated/`, NTSC-U `RMCE01`). Ghosts are input
recordings, so a ghost driven by a different physics result drifts off its line within seconds and
finishes far from its recorded time. Minithena did this on PAL with a native Mario Circuit ghost.

Everything below produces game-derived files (saves, screenshots, logs). They stay in gitignored
places: `work/wt-*/build-native/UserData`, `work/sites/<track>/`, `tools/browser-test/out/`.
Never commit or upload them.

## What is automated

| Piece | File |
| --- | --- |
| Native build | `work/Wiicompiled/build-native` (configure line below) |
| Bounded native run with scripted input and window grabs | `scripts/parity/native-run.sh` |
| Native menu routes (`at <sec> <verb>` lines) | `scripts/parity/native-race-staff-ghost.steps`, `native-watch-staff-replay.steps` |
| Stage the native save into a web site (copied as it is, listed in the manifests) | `scripts/parity/stage-save.sh` |
| Scripted Chrome driver (waits on console lines, screencast bursts) | `tools/browser-test/parity-drive.js` |
| Web menu route | `scripts/parity/web-race-staff-ghost.steps` |
| Ghost header reader (finish time, lap splits, course) | `scripts/parity/rkg-info.py` |
| All of it, plus contact sheets and the checklist | `scripts/parity/run-parity.sh` |

```bash
cd /home/mukul/code/mkwii-webgpu
eval "$(scripts/new-track.sh e)"
scripts/parity/run-parity.sh            # ~6 min plus waiting for the display lock
```

### The baseline that needs no human: the staff ghost

Every course's Time Trial has a normal staff ghost from the disc
(`Assets/DATA/files/Race/TimeAttack/ghost1/*.rkg`). Both routes race the **Luigi Circuit** staff
ghost (`Race This Ghost`) with nobody driving: the player's kart waits behind the start line, the
HUD timer runs, and the ghost comes past the camera and over the line at the end of lap 3. The
scripts grab frames for a few seconds around that moment on both sides.

Result on 2026-10-03 (RTX 4090, Chrome 154, X display, other builds loading the machine): at
matching HUD timer readings the ghost is at the same place in the native and web frames, and its
front wheels reach the checkered line when the timer shows the ghost's recorded finish time (from
`rkg-info.py` and the in-game Ghosts screen). Side-by-side: `tools/browser-test/out/e/parity-native-top-web-bottom.png`.

Why not "Watch the Replay": replays hide the HUD and loop back to the countdown after the finish,
so they cannot show a time (Minithena noted the same in HANDOVER.md).

Timer caveat: the HUD timer readings in grabbed frames are not on a 1/60 s grid (consecutive
frames differ by 13-24 ms), so compare the ghost's position at matching readings and accept the
crossing within about two frames. A diverged ghost is off by seconds, not milliseconds.

## The one step that needs a human: record your own ghost natively

The staff ghost proves that the web build matches *the disc's* recorded inputs. Minithena's check
also used a ghost recorded on the native build itself; that needs someone at a keyboard (an
open-loop xdotool script cannot finish three laps).

Checklist (about 10 minutes):

1. [ ] Build native once (`work/Wiicompiled/build-native/WiiCompiled` exists; see "Native build").
2. [ ] Run it on the desktop, no timeout: `cd work/Wiicompiled/build-native && ./WiiCompiled`
       (it reads `UserData/Config.toml` because `portable.txt` sits next to it).
3. [ ] Press **F10** -> Controller settings -> tick **Keyboard and mouse** (WASD preset;
       already done on this machine, saved in `UserData/keyboard_bindings.dat`). F10 again to close.
       Controls: left click = A (accelerate / confirm), Space = B, Enter = Start, arrows = D-pad,
       WASD = stick, Shift = L (item), right click = R (drift).
4. [ ] Title -> licence 1 (`Player`) -> Single Player -> Time Trials -> any character/kart ->
       **Mushroom Cup -> Luigi Circuit** -> Solo Time Trials. Drive three clean laps.
5. [ ] On the results screen write down the finish time and the three lap times. Let the game
       save the ghost (it does so for a new best time); quit with the window's close button.
6. [ ] Check the save holds it:
       `scripts/parity/rkg-info.py work/Wiicompiled/build-native/UserData/NAND/title/00010004/524d4345/data/rksys.dat`
       must list a `Luigi Circuit ... (player best time ...)` ghost with that time.

Then, automated again:

7. `scripts/parity/run-parity.sh` stages the new save. On the Ghosts screen the course now has
   more than one ghost (`1/2` at the top right); add a `key Right` (native) / `key ArrowRight`
   (web) step before "Race This Ghost" if your ghost is not the one shown first (check
   `04-ghosts.png`), and move the burst to GO + your finish time (`wait` in the web steps,
   `at` in the native steps; GO is about 8 s after the web `[web-warm] N players` line and about
   8 s after the native Start Race confirmation).
8. Compare as in the printed checklist. A personal ghost on another course needs the cup/course
   presses changed in both step files.

## Where things live on Linux

* Native user data: `$XDG_DATA_HOME/WiiCompiled` (default `~/.local/share/WiiCompiled`), unless a
  `portable.txt` is found next to the executable or up to four directories above it; then it is
  `<that directory>/UserData`. This machine uses the portable layout:
  `work/Wiicompiled/build-native/{portable.txt,UserData/}`.
* `Config.toml` in that directory; `[paths] dvd_root` points at `.../work/Wiicompiled/Assets/DATA`
  (the shared extracted disc). `graphics_api = "vulkan"`.
* Native NTSC-U save: `<user data>/NAND/title/00010004/524d4345/data/rksys.dat`
  (here `work/Wiicompiled/build-native/UserData/NAND/title/00010004/524d4345/data/rksys.dat`). PAL uses
  `524d4350`.
* Logs: `<user data>/Logs/<run>/`; the runtime also prints to stdout (captured as `stdout.log`).
* Web: the page seeds its NAND from `game/save/rksys.dat` on first start (or `?resetsave`) into
  the region's own title directory (fixed on `athena-web-ntsc`, commit c1ccae0; before that it always used the PAL one,
  so an NTSC-U web build ignored a staged save).

## Native build

```bash
cd work/Wiicompiled
export PATH=$HOME/tools/bin:$PATH
cmake -S runtime -B build-native -G Ninja -DCMAKE_MAKE_PROGRAM=$HOME/tools/bin/ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang-18 -DCMAKE_CXX_COMPILER=clang++-18 \
  -DAURORA_SDL3_PROVIDER=vendor -DMKW_BUILD_PRODUCTS=ON
cmake --build build-native --target WiiCompiled --parallel 6     # ~3.5 min clean at -j6
```

On Ubuntu 26.04, clang-16 with GCC 15's C++ library rejects an upstream `std::views::values`
use in aurora's `pad.cpp`, so build with clang-18 (installed alongside). SDL's Linux backends
need these development packages (the 26.04 upgrade removed them):

```bash
sudo apt install -y libdbus-1-dev libxcursor-dev libxrandr-dev libxtst-dev libxss-dev libibus-1.0-dev libwayland-dev wayland-protocols libdecor-0-dev libpipewire-0.3-dev libpulse-dev libsndio-dev liburing-dev libudev-dev libegl-dev libgbm-dev libdrm-dev libxkbcommon-x11-dev libusb-1.0-0-dev libsamplerate0-dev
```

No source change was needed for Linux. Runtime assets (`dsp_coef.bin`, `wii_bootstrap/`,
`initial_pipeline_cache.db`) are copied next to the executable by the build.

## Notes for script users

* `native-run.sh` and `parity-drive.js` both hold `/tmp/mkw-chrome.lock` (the wrapper does it for
  the web side); a run waits silently while another track holds it.
* Native input goes through xdotool to the focused game window; screenshots use `import`/`xwd` on
  the game window itself, never the whole screen. Do not use `ffmpeg -f x11grab`: it records
  whatever window is on top.
* Menu timings in the native step file are fixed offsets from launch (title at ~12 s). A D-pad
  press sent while a menu is still sliding in is lost (that once turned Time Trials into Grand
  Prix), so keep at least 3 s between a menu change and the next press.
