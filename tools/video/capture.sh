#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Record a scripted Chrome session of the game for the demo video (video/README.md).
#
#   tools/video/capture.sh boot            # page load, Start, shader compile, title     (~45 s)
#   tools/video/capture.sh gp              # the same, then a 50cc Grand Prix race driven by the bot (~2.5 min)
#   tools/video/capture.sh coconut-mall    # the same, then a VS race on Coconut Mall driven by the bot (~2.5 min)
#   tools/video/capture.sh mushroom-gorge  # ... on Mushroom Gorge (routes/demo-vs-*.cmds)
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
# The first run after a browser rebuild loses its route: the page's pipeline prewarm after Start
# takes a minute instead of 4 s while macOS's Metal shader cache is cold for the new binary, and
# the game ignores presses meanwhile. Run "boot" once first (video/README.md).
#
# On macOS the same steps run with the Mac's tools: the browser windows are placed with
# --window-position/--window-size in the main display's visible frame (tools/video/mac-windows.js),
# and one ffmpeg avfoundation recording of the screen (60 fps, no cursor) is cropped to each window's
# rectangle in physical pixels (2 per point on Retina) and encoded with h264_videotoolbox. Nothing
# may cover the windows while they record. The terminal needs Screen Recording permission (System
# Settings > Privacy & Security). The lock is a shlock pid file (/tmp/mkw-chrome.pid), and the
# time limit a shell timer (no GNU timeout). MKW_SCREEN picks the avfoundation screen device
# (default: "Capture screen 0" from ffmpeg -f avfoundation -list_devices true -i "").
#
# Environment: MKW_SITE (default work/sites/release-game/public, the staged site with the game
# folder), MKW_PORT (8032), MKW_DISC (a disc image for a site without a game folder: the page's
# picker is given it, read locally), DISPLAY (:0), MKW_WINDOW ("WxH+X+Y", default: the display's
# work area cut to MKW_ASPECT at its top; points on macOS), MKW_ASPECT (default 16:9, the video's
# shape, so the window fills the frame; "none" for the whole work area),
# MKW_RACE_SECONDS (multiplayer: how long both clients drive, default 30),
# MKW_BOT (multiplayer: 1, the default, drives both karts with tools/browser-test/kart-bot.js; 0 for
# the fixed keyboard drive), MKW_CHARACTER_KEYS_A / _B (multiplayer: menu keys on that client's
# character screen; B defaults to "d", one column right of Mario, so the two drivers differ),
# MKW_COURSE_KEYS (multiplayer: menu keys both clients press on the course vote before A; default
# three right and three down, Rainbow Road; empty for Luigi Circuit, the one under the cursor).
# MKW_BROWSER=portal records the Portal dev build (~/code/browser on ~/code/portal-chromium:
# PORTAL_BROWSER_REPO and PORTAL_CHROMIUM_ROOT override those paths, PORTAL_EXE the binary) with
# Portal's own chrome instead of Google Chrome; MKW_BROWSER=chrome is the default. In Portal the
# single-window routes also open MKW_EXTRA_TABS (space separated URLs; default portal.so and
# x.com/mukul0x, empty for none) as background tabs ahead of the game's tab.
# tools/browser-test/portal.js says how the drivers handle it.
set -euo pipefail
cd "$(dirname "$0")/../.."
mac=0; [ "$(uname -s)" = Darwin ] && mac=1
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
    if [ "$mac" = 1 ]; then exe="${PORTAL_EXE:-$croot/chromium/src/out/Default/Chromium.app/Contents/MacOS/Chromium}"
    else exe="${PORTAL_EXE:-$croot/chromium/src/out/Default/chrome}"; fi
    [ -x "$exe" ] || { echo "no Portal dev build under $croot/chromium/src/out (PORTAL_CHROMIUM_ROOT, PORTAL_EXE)" >&2; exit 1; }
    [ -d "$repo/dist-portal/assets" ] || { echo "no chrome bundle at $repo/dist-portal: build it in $repo (vite build --config src/chrome/vite.config.ts)" >&2; exit 1; }
    bun_exe="$(command -v bun)" || { echo "bun is needed for Portal's dev sidecar" >&2; exit 1; }
    # The same switches as $repo/scripts/chromium/03-run.sh, minus its --enable-features (ours
    # carries Vulkan and JSPI; a second --enable-features would replace it).
    portal_args="--portal-chrome --portal-chrome-dir=$repo/dist-portal --portal-sidecar-exe=$bun_exe --portal-sidecar-script=$repo/src/sidecar/index.ts --disable-features=HttpsFirstModeV2ForTypicallySecureUsers,TreesInViz"
    browser_env=(MKW_CHROME="$exe" MKW_PORTAL=1 MKW_EXTRA_TABS="${MKW_EXTRA_TABS-https://www.portal.so/ https://x.com/mukul0x}")
    ;;
  *) echo "MKW_BROWSER must be chrome or portal" >&2; exit 1 ;;
esac
name="${1:?usage: $0 <name> [route.cmds] [max-seconds]}"
case "$name" in
  boot)        route="${2:-tools/browser-test/routes/demo-boot.cmds}"; max="${3:-120}" ;;
  race)        route="${2:-tools/browser-test/routes/demo-race.cmds}"; max="${3:-330}" ;;
  gp)          route="${2:-tools/browser-test/routes/demo-gp.cmds}"; max="${3:-240}" ;;
  coconut-mall|mushroom-gorge) route="${2:-tools/browser-test/routes/demo-vs-$name.cmds}"; max="${3:-240}" ;;
  timetrial)   route="${2:-tools/browser-test/routes/demo-timetrial.cmds}"; max="${3:-260}" ;;
  multiplayer) route=room-test; max="${2:-600}" ;;
  *)           route="${2:?a route file (tools/browser-test/routes/*.cmds) is needed for $name}"; max="${3:-300}" ;;
esac
[ "$route" = room-test ] || [ -f "$route" ] || { echo "no such route: $route" >&2; exit 1; }
site="${MKW_SITE:-work/sites/release-game/public}"
port="${MKW_PORT:-8032}"
if [ "$mac" = 1 ]; then
  # The avfoundation device of the main display.
  screen="${MKW_SCREEN:-$({ ffmpeg -hide_banner -f avfoundation -list_devices true -i '' 2>&1 || true; } | sed -n 's/.*\[\([0-9]*\)\] Capture screen 0$/\1/p' | head -1)}"
  [ -n "$screen" ] || { echo "ffmpeg lists no 'Capture screen 0' avfoundation device (MKW_SCREEN)" >&2; exit 1; }
  display="avfoundation:$screen"
else
  export DISPLAY="${DISPLAY:-:0}"
  display="$DISPLAY"
fi
url="http://127.0.0.1:$port/WiiCompiled.html?muted"
out="video/public/captures/$name"
[ -d tools/browser-test/node_modules/playwright-core ] || { echo "run: (cd tools/browser-test && npm install)" >&2; exit 1; }
[ -d "$site" ] || { echo "no staged site at $site (MKW_SITE)" >&2; exit 1; }
case "$name" in gp|timetrial|coconut-mall|mushroom-gorge) [ -f "$site/game/save/rksys.dat" ] ;; *) true ;; esac \
  || echo "warning: the $name route expects a licence in slot 1, but $site/game has no save (tools/hosting/stage-game.sh --save)" >&2

rm -rf "$out"; mkdir -p "$out"
ffmpeg_pids=() rec_frags=()
# Stops the recordings. x11grab finishes its file on an INT. An avfoundation recording does not
# (a first INT is ignored, a second exits without the mp4's index), so on macOS it records a
# fragmented mp4, playable however ffmpeg stops (the last partial second is lost), and each is
# remuxed here into capture.mp4.
stop_recordings() {
  for p in "${ffmpeg_pids[@]}"; do
    kill -INT "$p" 2>/dev/null || continue
    if [ "$mac" = 1 ]; then
      for _ in $(seq 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
      kill -INT "$p" 2>/dev/null || true
      for _ in $(seq 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
      kill -9 "$p" 2>/dev/null || true
    fi
    wait "$p" 2>/dev/null || true
  done
  ffmpeg_pids=()
  # The fragment cut off by the stop ends in a truncated frame: the remux leaves out the last half second.
  for f in "${rec_frags[@]}"; do
    local keep; keep=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null | awk '{printf "%.3f", ($1 > 1 ? $1 - 0.5 : $1)}')
    ffmpeg -hide_banner -nostdin -loglevel error -y -i "$f" -t "${keep:-0}" -c copy -movflags +faststart "${f%.frag.mp4}.mp4" 2>>"${f%.frag.mp4}-ffmpeg.log" \
      && rm -f "$f" || echo "could not remux $f (see ${f%.frag.mp4}-ffmpeg.log)" >&2
  done
  rec_frags=()
}
cleanup() {
  stop_recordings
  if [ -n "${drive_pid:-}" ]; then kill "$drive_pid" 2>/dev/null || true; fi
  if [ -n "${server_pid:-}" ]; then kill "$server_pid" 2>/dev/null || true; fi
  if [ -n "${relay_pid:-}" ]; then kill "$relay_pid" 2>/dev/null || true; fi
  if [ "$(cat /tmp/mkw-chrome.pid 2>/dev/null)" = "$$" ]; then rm -f /tmp/mkw-chrome.pid; fi
}
trap cleanup EXIT

# The GPU/display lock: flock on Linux; macOS has none, so a shlock pid file there (a lock whose
# holder died is taken over).
take_lock() {
  if command -v flock >/dev/null; then flock 9; return; fi
  until shlock -f /tmp/mkw-chrome.pid -p $$; do sleep 1; done
}
# with_timeout <seconds> <command...>: GNU timeout --signal=INT; where there is none (macOS), a
# shell timer that sends INT, and passes on an INT or TERM sent to it.
with_timeout() {
  if command -v timeout >/dev/null; then timeout --signal=INT "$@"; return; fi
  local seconds=$1; shift
  "$@" & local pid=$!
  ( sleep "$seconds"; kill -INT "$pid" 2>/dev/null ) & local timer=$!
  trap 'kill -INT $pid 2>/dev/null' INT TERM
  local rc=0
  while kill -0 "$pid" 2>/dev/null; do wait "$pid" && rc=0 || rc=$?; done
  kill "$timer" 2>/dev/null || true
  return "$rc"
}
now_ms() { if [ "$mac" = 1 ]; then perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; else date +%s%3N; fi; }

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
# recording grabs each Chrome window by id. On macOS the work area is the main display's visible
# frame in points; scale is physical pixels per point.
scale=1
if [ -n "${MKW_WINDOW:-}" ]; then
  IFS='x+' read -r ww wh wx wy <<<"$MKW_WINDOW"
  [ "$mac" = 1 ] && read -r _ _ _ _ scale < <(osascript -l JavaScript tools/video/mac-windows.js workarea)
elif [ "$mac" = 1 ]; then
  read -r wx wy ww wh scale < <(osascript -l JavaScript tools/video/mac-windows.js workarea | awk '{printf "%d %d %d %d %s\n", $1, $2, $3, $4, $5}')
else
  read -r wx wy ww wh < <(xprop -root _NET_WORKAREA 2>/dev/null | sed 's/.*= //; s/,//g' | awk '{print $1, $2, $3, $4}')
  [ -n "${ww:-}" ] || { wx=0; wy=0; read -r ww wh < <(xdotool getdisplaygeometry); }
fi
# The video is 16:9 and a work area is not (a Mac's is 16:10 minus the menu bar), so the window
# is the work area cut to that shape at its top, and fills the frame without letterboxing.
aspect="${MKW_ASPECT:-16:9}"
if [ -z "${MKW_WINDOW:-}" ] && [ "$aspect" != none ]; then
  IFS=: read -r aw ah <<<"$aspect"
  if [ $((ww * ah)) -gt $((wh * aw)) ]; then ww=$((wh * aw / ah / 2 * 2)); else wh=$((ww * ah / aw / 2 * 2)); fi
fi

encoder=(-c:v libx264 -preset veryfast -crf 18)
if [ "$mac" = 1 ]; then
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox && encoder=(-c:v h264_videotoolbox -b:v 40M -profile:v high)
else
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc && nvidia-smi >/dev/null 2>&1 \
    && encoder=(-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 19 -b:v 0 -maxrate 40M -bufsize 80M)
fi

# The browser's windows carry a fixed X11 class (--class), so the recorder finds them whatever
# the browser and whatever CHROME_DESKTOP a launcher set. On macOS they are found by the process
# that owns them: the browser started on one of the drivers' fresh profiles.
if [ "$mac" = 1 ]; then common_args="--hide-crash-restore-bubble --no-default-browser-check ${portal_args:-}"
else common_args="--class=mkw-capture --ozone-platform=x11 --hide-crash-restore-bubble --no-default-browser-check ${portal_args:-}"; fi
# Visible capture windows at least 600 px wide that are normal toplevels and that x11grab can
# read (Portal has helper windows of the same class), as "id x y w h" lines. On macOS: the
# on-screen windows of the browsers on the drivers' profiles (pace-drive.js /tmp/mkw-pd-*,
# room-test.js mkw-room-*, Playwright's own for Chrome), "pid x y w h" in points.
chrome_windows() {
  if [ "$mac" = 1 ]; then
    local pids; pids=$(pgrep -f -- '--user-data-dir=[^ ]*(mkw-pd-|mkw-room-|playwright_chromiumdev_profile-)' | tr '\n' ' ')
    [ -n "${pids// /}" ] || return 0
    osascript -l JavaScript tools/video/mac-windows.js windows $pids
    return 0
  fi
  for id in $(xdotool search --onlyvisible --class mkw-capture 2>/dev/null); do
    xprop -id "$id" _NET_WM_WINDOW_TYPE 2>/dev/null | grep -q 'WINDOW_TYPE_NORMAL' || continue
    eval "$(xdotool getwindowgeometry --shell "$id" 2>/dev/null)" || continue
    [ "${WIDTH:-0}" -ge 600 ] || continue
    ffmpeg -loglevel quiet -y -f x11grab -window_id "$id" -i "$DISPLAY" -frames:v 1 -f null - 2>/dev/null || continue
    echo "$id $X $Y $((WIDTH / 2 * 2)) $((HEIGHT / 2 * 2))"
  done
}
# record <window id> <mp4> : starts ffmpeg on that window (cropped to even dimensions, as the
# encoders need); sets rec_start to its start time (epoch ms). Not in a $( ) subshell, so the
# pid lands in ffmpeg_pids and the recording can be stopped while the window is still there.
# (Two "Cannot get the image data" lines in the log are ffmpeg's shared-memory probe failing
# under Xwayland before it falls back; the frames are fine.)
record() {
  rec_start=$(now_ms)
  ffmpeg -hide_banner -nostdin -loglevel warning -y \
    -f x11grab -framerate 60 -window_id "$1" -draw_mouse 0 -thread_queue_size 1024 -i "$DISPLAY" \
    -vf 'crop=trunc(iw/2)*2:trunc(ih/2)*2' \
    "${encoder[@]}" -g 60 -pix_fmt yuv420p -movflags +faststart "$2" >"${2%.mp4}-ffmpeg.log" 2>&1 &
  ffmpeg_pids+=($!)
}
# record_screen <mp4> <x> <y> <w> <h> [<mp4> <x> <y> <w> <h>] (macOS): one avfoundation
# recording of the screen, cropped to each rectangle (points, scaled to pixels) into its own mp4;
# sets rec_start to the epoch ms of the first frame. avfoundation stamps frames on the host clock
# (mach time, Python's time.monotonic() here); ffmpeg prints the first one as the input's start.
record_screen() {
  local filter='' maps=() n=$(($# / 5)) i=0
  [ "$n" -gt 1 ] && filter="[0:v]split=$n$(for ((k = 0; k < n; k++)); do printf '[s%d]' "$k"; done);"
  while [ $# -ge 5 ]; do
    local src; [ "$n" -gt 1 ] && src="[s$i]" || src='[0:v]'
    filter+="${src}crop=$(($4 * scale / 2 * 2)):$(($5 * scale / 2 * 2)):$(($2 * scale)):$(($3 * scale)),format=yuv420p[o$i];"
    maps+=(-map "[o$i]" -fps_mode cfr -r 60 "${encoder[@]}" -g 60 -movflags +frag_keyframe+empty_moov "${1%.mp4}.frag.mp4")
    rec_frags+=("${1%.mp4}.frag.mp4")
    shift 5; i=$((i + 1))
  done
  local log="${maps[-1]%.frag.mp4}-ffmpeg.log"
  ffmpeg -hide_banner -nostdin -nostats -loglevel info -y \
    -f avfoundation -capture_cursor 0 -capture_mouse_clicks 0 -framerate 60 -pixel_format uyvy422 \
    -thread_queue_size 1024 -i "$screen:none" -filter_complex "${filter%;}" "${maps[@]}" >"$log" 2>&1 &
  ffmpeg_pids+=($!)
  local first=
  for _ in $(seq 100); do
    first=$(sed -n 's/.*Duration: N\/A, start: \([0-9.]*\),.*/\1/p' "$log" | head -1)
    [ -n "$first" ] && break; sleep 0.1
  done
  [ -n "$first" ] || { echo "ffmpeg did not start recording the screen (see $log)" >&2; exit 1; }
  rec_start=$(python3 -c 'import sys, time; print(round((float(sys.argv[1]) + time.time() - time.monotonic()) * 1000))' "$first")
}
write_meta() {  # write_meta <dir> <x> <y> <w> <h> <ffmpeg start ms>  (window in pixels)
  local duration; duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1/capture.mp4" 2>/dev/null || echo 0)
  cat >"$1/meta.json" <<JSON
{
  "name": "$name",
  "browser": "$browser",
  "platform": "$([ "$mac" = 1 ] && echo darwin || echo linux)",
  "route": "$route",
  "url": "$url",
  "display": "$display",
  "window": {"x": $2, "y": $3, "width": $4, "height": $5},
  "scale": $scale,
  "fps": 60,
  "ffmpegStartEpochMs": $6,
  "durationSec": ${duration:-0},
  "recordedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}
px() { echo $(($1 * scale)); }  # points to pixels (1 on Linux)

(
  trap stop_recordings EXIT  # the parent's trap does not run in this subshell, where the recordings start
  take_lock
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
    with_timeout "$max" env "${browser_env[@]}" CHROME_ARGS="$common_args" MKW_WINDOW_A="$wa" MKW_WINDOW_B="$wb" MKW_RACE_SECONDS="${MKW_RACE_SECONDS:-30}" \
      MKW_LICENCE="${MKW_LICENCE:-$licence}" MKW_BOT="${MKW_BOT:-1}" MKW_CHARACTER_KEYS_B="${MKW_CHARACTER_KEYS_B-d}" \
      MKW_COURSE_KEYS="${MKW_COURSE_KEYS-ArrowRight ArrowRight ArrowRight ArrowDown ArrowDown ArrowDown}" \
      MKW_SPACE_THEME_A="${MKW_SPACE_THEME_A:-#c8102e,70,30}" MKW_SPACE_THEME_B="${MKW_SPACE_THEME_B:-#2e8b3a,70,30}" \
      node tools/browser-test/room-test.js "$url" "$out" >"$out/room-test.out" 2>&1 &
    drive_pid=$!
    wins=
    for _ in $(seq 150); do
      wins=$(chrome_windows)
      [ "$(echo "$wins" | grep -c .)" -ge 2 ] && break; sleep 0.2
    done
    [ "$(echo "$wins" | grep -c .)" -ge 2 ] || { echo "two browser windows did not appear on $display (see $out/driver.log)" >&2; exit 1; }
    if [ "$mac" = 1 ]; then
      # The recording is of the screen, so it starts once both windows are where they stay: after
      # Portal's onboarding and space theming, when each client's launch is done (its "Chrome on
      # DISPLAY=" line), before either page opens.
      for _ in $(seq 600); do [ "$(grep -c ': Chrome on DISPLAY=' "$out/driver.log" 2>/dev/null)" -ge 2 ] && break; sleep 0.2; done
    else
      sleep 1.5
    fi
    wins=$(chrome_windows)
    read -r ida xa ya wwa wha < <(echo "$wins" | sort -k2 -n | head -1)
    read -r idb xb yb wwb whb < <(echo "$wins" | sort -k2 -n | tail -1)
    mkdir -p "$out/a" "$out/b"
    echo "recording window $ida (${wwa}x${wha}+${xa}+${ya}) as a and $idb (${wwb}x${whb}+${xb}+${yb}) as b"
    if [ "$mac" = 1 ]; then
      record_screen "$out/a/capture.mp4" "$xa" "$ya" "$wwa" "$wha" "$out/b/capture.mp4" "$xb" "$yb" "$wwb" "$whb"
      starta=$rec_start; startb=$rec_start
    else
      record "$ida" "$out/a/capture.mp4"; starta=$rec_start
      record "$idb" "$out/b/capture.mp4"; startb=$rec_start
    fi
    while kill -0 "$drive_pid" 2>/dev/null && ! grep -q 'mark end' "$out/console-a.log" 2>/dev/null; do sleep 0.5; done
    stop_recordings
    wait "$drive_pid" || echo "room-test ended with status $? (see $out/driver.log)"
    drive_pid=
    mv "$out/console-a.log" "$out/a/console.log"; mv "$out/console-b.log" "$out/b/console.log"
    write_meta "$out/a" "$(px "$xa")" "$(px "$ya")" "$(px "$wwa")" "$(px "$wha")" "$starta"
    write_meta "$out/b" "$(px "$xb")" "$(px "$yb")" "$(px "$wwb")" "$(px "$whb")" "$startb"
  else
    echo "capture $name: lock held, route $route, window ${ww}x${wh}+${wx}+${wy}, up to ${max}s"
    # 3. Chrome on a blank page first, so the recording starts before the page loads.
    : >"$out/cmds"
    with_timeout "$max" env "${browser_env[@]}" VIEWPORT=none IGNORE_DEFAULT_ARGS=--enable-automation \
      CHROME_ARGS="$common_args --window-position=$wx,$wy --window-size=$ww,$wh" \
      node tools/browser-test/pace-drive.js about:blank "$out" &
    drive_pid=$!
    win=
    for _ in $(seq 100); do win=$(chrome_windows | head -1); [ -n "$win" ] && break; sleep 0.2; done
    [ -n "$win" ] || { echo "no browser window appeared on $display (see $out/driver.log)" >&2; exit 1; }
    if [ "$mac" = 1 ]; then
      # Portal's window is where it stays once onboarding is released and the visible tab found.
      ready='args: '; [ "$browser" = portal ] && ready='driving the visible tab'
      for _ in $(seq 300); do grep -q "$ready" "$out/driver.log" 2>/dev/null && break; sleep 0.2; done
    fi
    sleep 1.5
    # The window as the window manager placed it (it may have maximised it); meta.json records that.
    read -r wid wx wy ww wh < <(chrome_windows | head -1)
    echo "recording window $wid (${ww}x${wh}+${wx}+${wy}) of $display"
    # 4. Record the window.
    if [ "$mac" = 1 ]; then record_screen "$out/capture.mp4" "$wx" "$wy" "$ww" "$wh"; else record "$wid" "$out/capture.mp4"; fi
    start=$rec_start
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
    stop_recordings
    echo quit >>"$out/cmds"
    wait "$drive_pid" || echo "driver ended with status $? (timeout ${max}s or an error; see $out/driver.log)"
    drive_pid=
    write_meta "$out" "$(px "$wx")" "$(px "$wy")" "$(px "$ww")" "$(px "$wh")" "$start"
  fi
) 9>/tmp/mkw-chrome.lock

for dir in $([ "$route" = room-test ] && echo "$out/a $out/b" || echo "$out"); do
  node video/scripts/perf-to-json.mjs "$dir"
  duration=$(python3 -c "import json; print(json.load(open('$dir/meta.json'))['durationSec'])")
  echo "capture $name: $dir/capture.mp4 ($(du -h "$dir/capture.mp4" | cut -f1), $(printf %.1f "$duration") s)"
done
