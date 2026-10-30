#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Record a scripted Chrome session of the game for the demo video (video/README.md).
#
#   tools/video/capture.sh boot            # page load, Start, opening, title      (~45 s)
#   tools/video/capture.sh race            # the same, then a 50cc Grand Prix race (~4.5 min)
#   tools/video/capture.sh <name> <route.cmds> [max-seconds]
#
# What it does: serves the staged site on 127.0.0.1 (unless something already listens on the
# port), takes the GPU/display lock (/tmp/mkw-chrome.lock, see tools/browser-test/README.md),
# opens the real Chrome on DISPLAY :0 with tools/browser-test/pace-drive.js, records the Chrome
# window with ffmpeg x11grab at 60 fps (NVENC H.264 when available, else libx264), runs the route
# and writes to video/public/captures/<name>/:
#   capture.mp4   the recording           console.log   the page's console (with driver marks)
#   meta.json     window, times, length   perf.json     fps samples and marks on the video clock
#   driver.log, cmds                      (and any screenshots the route takes)
# The capture folder is gitignored: it shows the game and never goes into git.
#
# Environment: MKW_SITE (default work/sites/release-game/public, the staged site with the game
# folder), MKW_PORT (8032), MKW_DISC (a disc image for a site without a game folder: the page's
# picker is given it, read locally), DISPLAY (:0), MKW_WINDOW ("WxH+X+Y", default: the display's
# work area, as the window manager places the window).
set -euo pipefail
cd "$(dirname "$0")/../.."
name="${1:?usage: $0 <name> [route.cmds] [max-seconds]}"
case "$name" in
  boot) route="${2:-tools/browser-test/routes/demo-boot.cmds}"; max="${3:-120}" ;;
  race) route="${2:-tools/browser-test/routes/demo-race.cmds}"; max="${3:-330}" ;;
  *)    route="${2:?a route file (tools/browser-test/routes/*.cmds) is needed for $name}"; max="${3:-300}" ;;
esac
[ -f "$route" ] || { echo "no such route: $route" >&2; exit 1; }
site="${MKW_SITE:-work/sites/release-game/public}"
port="${MKW_PORT:-8032}"
export DISPLAY="${DISPLAY:-:0}"
url="http://127.0.0.1:$port/WiiCompiled.html?muted"
out="video/public/captures/$name"
[ -d tools/browser-test/node_modules/playwright-core ] || { echo "run: (cd tools/browser-test && npm install)" >&2; exit 1; }
[ -d "$site" ] || { echo "no staged site at $site (MKW_SITE)" >&2; exit 1; }

rm -rf "$out"; mkdir -p "$out"
cleanup() {
  if [ -n "${ffmpeg_pid:-}" ]; then kill -INT "$ffmpeg_pid" 2>/dev/null || true; wait "$ffmpeg_pid" 2>/dev/null || true; fi
  if [ -n "${drive_pid:-}" ]; then kill "$drive_pid" 2>/dev/null || true; fi
  if [ -n "${server_pid:-}" ]; then kill "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

# 1. The site, unless a server already answers on the port.
if ! curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" 2>/dev/null; then
  python3 tools/hosting/serve.py "$site" --port "$port" >"$out/server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 50); do curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" 2>/dev/null && break; sleep 0.2; done
  curl -fsS -o /dev/null "http://127.0.0.1:$port/WiiCompiled.html" || { echo "the server did not come up (see $out/server.log)" >&2; exit 1; }
fi

# 2. Window placement: the display's work area (the screen minus panels), or MKW_WINDOW. Chrome is
# asked for an X11 window (on a Wayland desktop it would otherwise open a Wayland window that
# neither xdotool nor ffmpeg's x11grab can see), and the recording grabs that window by id: under
# rootless Xwayland the X root window is black, only the window itself has the pixels.
if [ -n "${MKW_WINDOW:-}" ]; then
  IFS='x+' read -r ww wh wx wy <<<"$MKW_WINDOW"
else
  read -r wx wy ww wh < <(xprop -root _NET_WORKAREA 2>/dev/null | sed 's/.*= //; s/,//g' | awk '{print $1, $2, $3, $4}')
  [ -n "${ww:-}" ] || { wx=0; wy=0; read -r ww wh < <(xdotool getdisplaygeometry); }
fi

encoder=(-c:v libx264 -preset veryfast -crf 18)
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc && nvidia-smi >/dev/null 2>&1 \
  && encoder=(-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 19 -b:v 0 -maxrate 40M -bufsize 80M)

(
  flock 9
  echo "capture $name: lock held, route $route, window ${ww}x${wh}+${wx}+${wy}, up to ${max}s"
  # 3. Chrome on a blank page first, so the recording starts before the page loads.
  : >"$out/cmds"
  VIEWPORT=none IGNORE_DEFAULT_ARGS=--enable-automation \
  CHROME_ARGS="--ozone-platform=x11 --window-position=$wx,$wy --window-size=$ww,$wh --hide-crash-restore-bubble --no-default-browser-check" \
    timeout --signal=INT "$max" node tools/browser-test/pace-drive.js about:blank "$out" &
  drive_pid=$!
  wid=
  for _ in $(seq 100); do
    wid=$(xdotool search --onlyvisible --class google-chrome 2>/dev/null | tail -1 || true)
    [ -n "$wid" ] && break; sleep 0.2
  done
  [ -n "$wid" ] || { echo "no Chrome window appeared on $DISPLAY (see $out/driver.log)" >&2; exit 1; }
  sleep 1.5
  # The window as the window manager placed it (it may have maximised it); meta.json records that.
  eval "$(xdotool getwindowgeometry --shell "$wid")"   # X Y WIDTH HEIGHT
  wx=$X; wy=$Y; ww=$((WIDTH / 2 * 2)); wh=$((HEIGHT / 2 * 2))
  echo "recording window $wid (${ww}x${wh}+${wx}+${wy}) of $DISPLAY"
  # 4. Record the window. (Two "Cannot get the image data" lines in ffmpeg.log are its shared
  # memory probe failing under Xwayland before it falls back; the frames are fine.)
  ffmpeg_start_ms=$(date +%s%3N)
  ffmpeg -hide_banner -nostdin -loglevel warning -y \
    -f x11grab -framerate 60 -window_id "$wid" -draw_mouse 0 -thread_queue_size 1024 -i "$DISPLAY" \
    "${encoder[@]}" -g 60 -pix_fmt yuv420p -movflags +faststart "$out/capture.mp4" >"$out/ffmpeg.log" 2>&1 &
  ffmpeg_pid=$!
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
  kill -INT "$ffmpeg_pid" 2>/dev/null || true; wait "$ffmpeg_pid" || true; ffmpeg_pid=
  echo quit >>"$out/cmds"
  wait "$drive_pid" || echo "driver ended with status $? (timeout ${max}s or an error; see $out/driver.log)"
  drive_pid=
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/capture.mp4" || echo 0)
  cat >"$out/meta.json" <<JSON
{
  "name": "$name",
  "route": "$route",
  "url": "$url",
  "display": "$DISPLAY",
  "window": {"x": $wx, "y": $wy, "width": $ww, "height": $wh},
  "fps": 60,
  "ffmpegStartEpochMs": $ffmpeg_start_ms,
  "durationSec": ${duration:-0},
  "recordedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
) 9>/tmp/mkw-chrome.lock

node video/scripts/perf-to-json.mjs "$out"
duration=$(python3 -c "import json; print(json.load(open('$out/meta.json'))['durationSec'])")
echo "capture $name: $out/capture.mp4 ($(du -h "$out/capture.mp4" | cut -f1), $(printf %.1f "$duration") s)"
