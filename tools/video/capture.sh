#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Record a scripted Chrome session of the game for the demo video (video/README.md).
#
#   tools/video/capture.sh boot            # page load, Start, shader compile, title     (~45 s)
#   tools/video/capture.sh timetrial       # the same, then a Time Trial on the staff ghost's inputs (~3 min)
#   tools/video/capture.sh race            # the same, then a 50cc Grand Prix race       (~4 min)
#   tools/video/capture.sh multiplayer     # two clients in one race through the relay   (~4 min)
#   tools/video/capture.sh <name> <route.cmds> [max-seconds]
#
# What it does: serves the staged site on 127.0.0.1 (unless something already listens on the
# port), takes the GPU/display lock (/tmp/mkw-chrome.lock, see tools/browser-test/README.md),
# opens the real Chrome on DISPLAY :0 as an X11 window (on a Wayland desktop a Wayland window
# could not be recorded), drives it with tools/browser-test/pace-drive.js and the route, records
# the window by id with ffmpeg x11grab at 60 fps (NVENC H.264 when available, else libx264) and
# writes to video/public/captures/<name>/:
#   capture.mp4   the recording           console.log   the page's console (with driver marks)
#   meta.json     window, times, length   perf.json     fps samples and marks on the video clock
#   driver.log, cmds                      (and any screenshots the route takes)
# "multiplayer" runs tools/browser-test/room-test.js instead (two Chrome windows side by side,
# the room relay from tools/relay/dev-local.sh on 127.0.0.1:8787 unless one is running) and
# records each window: video/public/captures/multiplayer/a/ and /b/, each with the files above.
# The capture folder is gitignored: it shows the game and never goes into git.
#
# Environment: MKW_SITE (default work/sites/release-game/public, the staged site with the game
# folder), MKW_PORT (8032), MKW_DISC (a disc image for a site without a game folder: the page's
# picker is given it, read locally), DISPLAY (:0), MKW_WINDOW ("WxH+X+Y", default: the display's
# work area), MKW_RACE_SECONDS (multiplayer: how long both clients drive, default 30).
# MKW_BROWSER=portal records the Portal dev build (~/code/browser on ~/code/portal-chromium:
# PORTAL_BROWSER_REPO and PORTAL_CHROMIUM_ROOT override those paths) with Portal's own chrome
# instead of Google Chrome; MKW_BROWSER=chrome is the default. tools/browser-test/portal.js says
# how the drivers handle it.
set -euo pipefail
cd "$(dirname "$0")/../.."
browser="${MKW_BROWSER:-chrome}"
browser_env=()
case "$browser" in
  chrome) ;;
  portal)
    repo="${PORTAL_BROWSER_REPO:-$HOME/code/browser}"
    croot="${PORTAL_CHROMIUM_ROOT:-$HOME/code/portal-chromium}"
    # The build's portal.mojom must match the chrome bundle, or the window shows "portal.mojom hash
    # mismatch": in the browser repo, scripts/chromium/export-mojom-bindings.sh then
    # `node_modules/.bin/vite build --config src/chrome/vite.config.ts`. PORTAL_EXE picks the binary
    # (default: out/Default, the build scripts/chromium/02-build.sh makes).
    exe="${PORTAL_EXE:-$croot/chromium/src/out/Default/chrome}"
    [ -x "$exe" ] || { echo "no Portal dev build under $croot/chromium/src/out (PORTAL_CHROMIUM_ROOT, PORTAL_EXE)" >&2; exit 1; }
    [ -d "$repo/dist-portal/assets" ] || { echo "no chrome bundle at $repo/dist-portal: build it in $repo (vite build --config src/chrome/vite.config.ts)" >&2; exit 1; }
    bun_exe="$(command -v bun)" || { echo "bun is needed for Portal's dev sidecar" >&2; exit 1; }
    # The same switches as $repo/scripts/chromium/03-run.sh, minus its --enable-features (ours
    # carries Vulkan and JSPI; a second --enable-features would replace it).
    portal_args="--portal-chrome --portal-chrome-dir=$repo/dist-portal --portal-sidecar-exe=$bun_exe --portal-sidecar-script=$repo/src/sidecar/index.ts --disable-features=HttpsFirstModeV2ForTypicallySecureUsers,TreesInViz"
    browser_env=(MKW_CHROME="$exe" MKW_PORTAL=1)
    ;;
  *) echo "MKW_BROWSER must be chrome or portal" >&2; exit 1 ;;
esac
name="${1:?usage: $0 <name> [route.cmds] [max-seconds]}"
case "$name" in
  boot)        route="${2:-tools/browser-test/routes/demo-boot.cmds}"; max="${3:-120}" ;;
  race)        route="${2:-tools/browser-test/routes/demo-race.cmds}"; max="${3:-330}" ;;
  timetrial)   route="${2:-tools/browser-test/routes/demo-timetrial.cmds}"; max="${3:-260}" ;;
  multiplayer) route=room-test; max="${2:-600}" ;;
  *)           route="${2:?a route file (tools/browser-test/routes/*.cmds) is needed for $name}"; max="${3:-300}" ;;
esac
[ "$route" = room-test ] || [ -f "$route" ] || { echo "no such route: $route" >&2; exit 1; }
site="${MKW_SITE:-work/sites/release-game/public}"
port="${MKW_PORT:-8032}"
export DISPLAY="${DISPLAY:-:0}"
url="http://127.0.0.1:$port/WiiCompiled.html?muted"
out="video/public/captures/$name"
[ -d tools/browser-test/node_modules/playwright-core ] || { echo "run: (cd tools/browser-test && npm install)" >&2; exit 1; }
[ -d "$site" ] || { echo "no staged site at $site (MKW_SITE)" >&2; exit 1; }
[ "$name" != timetrial ] || [ -f "$site/game/save/rksys.dat" ] \
  || echo "warning: the timetrial route expects a licence in slot 1, but $site/game has no save (tools/hosting/stage-game.sh --save)" >&2

rm -rf "$out"; mkdir -p "$out"
ffmpeg_pids=()
cleanup() {
  for p in "${ffmpeg_pids[@]}"; do kill -INT "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; done
  if [ -n "${drive_pid:-}" ]; then kill "$drive_pid" 2>/dev/null || true; fi
  if [ -n "${server_pid:-}" ]; then kill "$server_pid" 2>/dev/null || true; fi
  if [ -n "${relay_pid:-}" ]; then kill "$relay_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

# 1. The site, unless a server already answers on the port.
if ! curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" 2>/dev/null; then
  python3 tools/hosting/serve.py "$site" --port "$port" >"$out/server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 50); do curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" 2>/dev/null && break; sleep 0.2; done
  curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" || { echo "the server did not come up (see $out/server.log)" >&2; exit 1; }
fi
# 1b. The room relay, for multiplayer, unless one is running.
if [ "$route" = room-test ] && ! curl -s -o /dev/null http://127.0.0.1:8787/ 2>/dev/null; then
  tools/relay/dev-local.sh >"$out/relay.log" 2>&1 &
  relay_pid=$!
  for _ in $(seq 300); do curl -s -o /dev/null http://127.0.0.1:8787/ 2>/dev/null && break; sleep 0.2; done
  curl -s -o /dev/null http://127.0.0.1:8787/ || { echo "the relay did not come up (see $out/relay.log)" >&2; exit 1; }
fi

# 2. Window placement: the display's work area (the screen minus panels), or MKW_WINDOW. Under
# rootless Xwayland the X root window is black, only the windows themselves have pixels, so the
# recording grabs each Chrome window by id.
if [ -n "${MKW_WINDOW:-}" ]; then
  IFS='x+' read -r ww wh wx wy <<<"$MKW_WINDOW"
else
  read -r wx wy ww wh < <(xprop -root _NET_WORKAREA 2>/dev/null | sed 's/.*= //; s/,//g' | awk '{print $1, $2, $3, $4}')
  [ -n "${ww:-}" ] || { wx=0; wy=0; read -r ww wh < <(xdotool getdisplaygeometry); }
fi

encoder=(-c:v libx264 -preset veryfast -crf 18)
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc && nvidia-smi >/dev/null 2>&1 \
  && encoder=(-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 19 -b:v 0 -maxrate 40M -bufsize 80M)

# The browser's windows carry a fixed X11 class (--class), so the recorder finds them whatever
# the browser and whatever CHROME_DESKTOP a launcher set.
common_args="--class=mkw-capture --ozone-platform=x11 --hide-crash-restore-bubble --no-default-browser-check ${portal_args:-}"
# Visible capture windows at least 600 px wide that are normal toplevels and that x11grab can
# read (Portal has helper windows of the same class), as "id x y w h" lines.
chrome_windows() {
  for id in $(xdotool search --onlyvisible --class mkw-capture 2>/dev/null); do
    xprop -id "$id" _NET_WM_WINDOW_TYPE 2>/dev/null | grep -q 'WINDOW_TYPE_NORMAL' || continue
    eval "$(xdotool getwindowgeometry --shell "$id" 2>/dev/null)" || continue
    [ "${WIDTH:-0}" -ge 600 ] || continue
    ffmpeg -loglevel quiet -y -f x11grab -window_id "$id" -i "$DISPLAY" -frames:v 1 -f null - 2>/dev/null || continue
    echo "$id $X $Y $((WIDTH / 2 * 2)) $((HEIGHT / 2 * 2))"
  done
}
# record <window id> <mp4> : starts ffmpeg on that window (cropped to even dimensions, as the
# encoders need); prints its start time (epoch ms).
# (Two "Cannot get the image data" lines in the log are ffmpeg's shared-memory probe failing
# under Xwayland before it falls back; the frames are fine.)
record() {
  local started; started=$(date +%s%3N)
  ffmpeg -hide_banner -nostdin -loglevel warning -y \
    -f x11grab -framerate 60 -window_id "$1" -draw_mouse 0 -thread_queue_size 1024 -i "$DISPLAY" \
    -vf 'crop=trunc(iw/2)*2:trunc(ih/2)*2' \
    "${encoder[@]}" -g 60 -pix_fmt yuv420p -movflags +faststart "$2" >"${2%.mp4}-ffmpeg.log" 2>&1 &
  ffmpeg_pids+=($!)
  echo "$started"
}
write_meta() {  # write_meta <dir> <x> <y> <w> <h> <ffmpeg start ms>
  local duration; duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1/capture.mp4" 2>/dev/null || echo 0)
  cat >"$1/meta.json" <<JSON
{
  "name": "$name",
  "browser": "$browser",
  "route": "$route",
  "url": "$url",
  "display": "$DISPLAY",
  "window": {"x": $2, "y": $3, "width": $4, "height": $5},
  "fps": 60,
  "ffmpegStartEpochMs": $6,
  "durationSec": ${duration:-0},
  "recordedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

(
  flock 9
  if [ "$route" = room-test ]; then
    # Two clients side by side, each half the work area.
    half=$((ww / 2 / 2 * 2))
    wa="${half}x${wh}+${wx}+${wy}"; wb="${half}x${wh}+$((wx + half))+${wy}"
    echo "capture $name: lock held, two clients at $wa and $wb, up to ${max}s"
    # In Portal the two windows get differently coloured spaces (red and green, like the karts'
    # players); MKW_SPACE_THEME_A/_B ("#rrggbb[,strength[,grain]]") pick others.
    # A site whose game folder seeds a save already has a licence: the clients skip the setup
    # screens (room-test.js MKW_LICENCE=0).
    licence=1; [ -f "$site/game/save/rksys.dat" ] && licence=0
    env "${browser_env[@]}" CHROME_ARGS="$common_args" MKW_WINDOW_A="$wa" MKW_WINDOW_B="$wb" MKW_RACE_SECONDS="${MKW_RACE_SECONDS:-30}" \
      MKW_LICENCE="${MKW_LICENCE:-$licence}" \
      MKW_SPACE_THEME_A="${MKW_SPACE_THEME_A:-#c8102e,70,30}" MKW_SPACE_THEME_B="${MKW_SPACE_THEME_B:-#2e8b3a,70,30}" \
      timeout --signal=INT "$max" node tools/browser-test/room-test.js "$url" "$out" >"$out/room-test.out" 2>&1 &
    drive_pid=$!
    wins=
    for _ in $(seq 150); do
      wins=$(chrome_windows)
      [ "$(echo "$wins" | grep -c .)" -ge 2 ] && break; sleep 0.2
    done
    [ "$(echo "$wins" | grep -c .)" -ge 2 ] || { echo "two browser windows did not appear on $DISPLAY (see $out/driver.log)" >&2; exit 1; }
    sleep 1.5
    wins=$(chrome_windows)
    read -r ida xa ya wwa wha < <(echo "$wins" | sort -k2 -n | head -1)
    read -r idb xb yb wwb whb < <(echo "$wins" | sort -k2 -n | tail -1)
    mkdir -p "$out/a" "$out/b"
    echo "recording window $ida (${wwa}x${wha}+${xa}+${ya}) as a and $idb (${wwb}x${whb}+${xb}+${yb}) as b"
    starta=$(record "$ida" "$out/a/capture.mp4")
    startb=$(record "$idb" "$out/b/capture.mp4")
    while kill -0 "$drive_pid" 2>/dev/null && ! grep -q 'mark end' "$out/console-a.log" 2>/dev/null; do sleep 0.5; done
    for p in "${ffmpeg_pids[@]}"; do kill -INT "$p" 2>/dev/null || true; wait "$p" || true; done; ffmpeg_pids=()
    wait "$drive_pid" || echo "room-test ended with status $? (see $out/driver.log)"
    drive_pid=
    mv "$out/console-a.log" "$out/a/console.log"; mv "$out/console-b.log" "$out/b/console.log"
    write_meta "$out/a" "$xa" "$ya" "$wwa" "$wha" "$starta"
    write_meta "$out/b" "$xb" "$yb" "$wwb" "$whb" "$startb"
  else
    echo "capture $name: lock held, route $route, window ${ww}x${wh}+${wx}+${wy}, up to ${max}s"
    # 3. Chrome on a blank page first, so the recording starts before the page loads.
    : >"$out/cmds"
    env "${browser_env[@]}" VIEWPORT=none IGNORE_DEFAULT_ARGS=--enable-automation \
    CHROME_ARGS="$common_args --window-position=$wx,$wy --window-size=$ww,$wh" \
      timeout --signal=INT "$max" node tools/browser-test/pace-drive.js about:blank "$out" &
    drive_pid=$!
    win=
    for _ in $(seq 100); do win=$(chrome_windows | head -1); [ -n "$win" ] && break; sleep 0.2; done
    [ -n "$win" ] || { echo "no browser window appeared on $DISPLAY (see $out/driver.log)" >&2; exit 1; }
    sleep 1.5
    # The window as the window manager placed it (it may have maximised it); meta.json records that.
    read -r wid wx wy ww wh < <(chrome_windows | head -1)
    echo "recording window $wid (${ww}x${wh}+${wx}+${wy}) of $DISPLAY"
    # 4. Record the window.
    start=$(record "$wid" "$out/capture.mp4")
    sleep 1
    # 5. The route: load the page, run the script; then stop the recording while the window is still
    # there (ffmpeg dies with BadMatch when the window it grabs goes away) and close Chrome.
    {
      [ -n "${MKW_DISC:-}" ] && echo "goto $url&disc=local" || echo "goto $url"
      [ -n "${MKW_DISC:-}" ] && echo "pick $MKW_DISC"
      echo "script $route"
      echo "mark end-of-route"
    } >>"$out/cmds"
    while kill -0 "$drive_pid" 2>/dev/null && ! grep -q 'done: mark end-of-route' "$out/driver.log" 2>/dev/null; do sleep 0.5; done
    for p in "${ffmpeg_pids[@]}"; do kill -INT "$p" 2>/dev/null || true; wait "$p" || true; done; ffmpeg_pids=()
    echo quit >>"$out/cmds"
    wait "$drive_pid" || echo "driver ended with status $? (timeout ${max}s or an error; see $out/driver.log)"
    drive_pid=
    write_meta "$out" "$wx" "$wy" "$ww" "$wh" "$start"
  fi
) 9>/tmp/mkw-chrome.lock

for dir in $([ "$route" = room-test ] && echo "$out/a $out/b" || echo "$out"); do
  node video/scripts/perf-to-json.mjs "$dir"
  duration=$(python3 -c "import json; print(json.load(open('$dir/meta.json'))['durationSec'])")
  echo "capture $name: $dir/capture.mp4 ($(du -h "$dir/capture.mp4" | cut -f1), $(printf %.1f "$duration") s)"
done
