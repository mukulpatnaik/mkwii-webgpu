#!/usr/bin/env bash
# Run the native Linux WiiCompiled product for a bounded time on the X display, under the shared
# GPU/display lock, and capture its console plus window screenshots.
#
#   scripts/parity/native-run.sh <seconds> <outdir> [input-script]
#
# The optional input script has one step per line, "at <sec> <verb> [args]", run in order once the
# game window exists (<sec> counts from launch; a step never runs before the previous one):
#   at 12 a                  press A (left mouse button over the game; needs keyboard+mouse on port 1)
#   at 13 key Down [ms]      press a key (X keysym name) for ms milliseconds (default 120)
#   at 14 hold a 5000        hold A (or a key) for 5000 ms
#   at 15 shot <name>        screenshot the game window to <outdir>/<name>.png
#   at 140 burst <name> 6    screenshots of the window as fast as possible for 6 s (in the
#                            background) -> <outdir>/<name>/<ms since burst start>.png
# Screenshots are also taken every 15 s (PERIODIC=0 turns that off). Everything written to <outdir>
# is game-derived (screenshots, logs): keep it under the gitignored tools/browser-test/out/.
#
# Port 1 must have "Keyboard and mouse" switched on (F10 -> Controller settings -> Keyboard and
# mouse, which applies the WASD + mouse preset); the setting is saved next to Config.toml.
#
# Environment:
#   NATIVE_BUILD  native build directory (default: work/wt-e/build-native)
#   PERIODIC      seconds between automatic screenshots, 0 = none (default 15)
#   NO_LOCK=1     do not take /tmp/mkw-chrome.lock (only when the caller already holds it)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
seconds="${1:?seconds}"; outdir="${2:?outdir}"; script="${3:-}"
build="${NATIVE_BUILD:-$ROOT/work/wt-e/build-native}"
periodic="${PERIODIC:-15}"
[ -x "$build/WiiCompiled" ] || { echo "no native build at $build" >&2; exit 1; }
mkdir -p "$outdir"; outdir="$(cd "$outdir" && pwd)"
[ -z "$script" ] || script="$(cd "$(dirname "$script")" && pwd)/$(basename "$script")"
export DISPLAY="${DISPLAY:-:0}"

if [ -z "${NO_LOCK:-}" ]; then
  exec flock /tmp/mkw-chrome.lock env NO_LOCK=1 NATIVE_BUILD="$build" PERIODIC="$periodic" \
    "$0" "$seconds" "$outdir" ${script:+"$script"}
fi

log() { echo "$(date +%T) $*" >> "$outdir/driver.log"; }

# The window manager wraps the game's window in a decorated frame; both carry the title.
frame=""; client=""
find_windows() {
  frame=""; client=""
  local w width
  for w in $(xdotool search --name '^WiiCompiled$' 2>/dev/null); do
    width="$(xwininfo -id "$w" 2>/dev/null | awk '/Width:/{print $2}')"
    [ -n "$width" ] || continue
    if [ -z "$frame" ]; then frame="$w"; continue; fi
    # the frame is the larger of the two
    if [ "$width" -gt "$(xwininfo -id "$frame" | awk '/Width:/{print $2}')" ]; then client="$frame"; frame="$w"; else client="$w"; fi
  done
  [ -n "$client" ] || client="$frame"
}

shot() {
  find_windows
  if [ -n "$frame" ]; then import -window "$frame" "$outdir/$1.png" 2>/dev/null || true
  else import -window root "$outdir/$1.png" 2>/dev/null || true; fi
  log "shot $outdir/$1.png"
}

burst() {  # burst <name> <seconds>: back-to-back window grabs, in the background
  find_windows
  [ -n "$frame" ] || { log "no game window to grab"; return; }
  local dir="$outdir/$1" secs="$2" win="$frame"
  mkdir -p "$dir"
  (
    t0=$(date +%s%3N)
    while [ $(( $(date +%s%3N) - t0 )) -lt $((secs * 1000)) ]; do
      xwd -id "$win" -silent -out "$dir/$(printf %06d $(( $(date +%s%3N) - t0 ))).xwd" 2>/dev/null || break
    done
    for f in "$dir"/*.xwd; do convert "$f" "${f%.xwd}.png" && rm -f "$f"; done
    echo "$(date +%T) burst $1: $(ls "$dir" | wc -l) frames" >> "$outdir/driver.log"
  ) &
}

press() {  # press <a|keysym> <ms>
  local what="$1" ms="${2:-120}" secs
  secs="$(awk -v m="$ms" 'BEGIN{printf "%.3f", m/1000}')"
  find_windows
  [ -n "$client" ] || { log "no game window for: $what"; return; }
  timeout 3 xdotool windowactivate "$client" 2>/dev/null || true
  if [ "$what" = a ]; then
    eval "$(xwininfo -id "$client" | awk '/Absolute upper-left X/{print "cx="$4} /Absolute upper-left Y/{print "cy="$4} /Width:/{print "cw="$2} /Height:/{print "ch="$2}')"
    timeout 5 xdotool mousemove "$((cx + cw / 2))" "$((cy + ch / 2))" sleep 0.1 mousedown 1 sleep "$secs" mouseup 1 || true
  else
    timeout 5 xdotool keydown "$what" sleep "$secs" keyup "$what" || true
  fi
}

cd "$build"
start=$(date +%s)
timeout --signal=TERM --kill-after=10 "$seconds" ./WiiCompiled > "$outdir/stdout.log" 2>&1 &
pid=$!
log "started pid $pid for ${seconds}s in $build"

declare -a lines=()
[ -n "$script" ] && mapfile -t lines < <(grep -v '^\s*#' "$script" | grep -v '^\s*$')
i=0; next_periodic="$periodic"
while kill -0 "$pid" 2>/dev/null; do
  now=$(( $(date +%s) - start ))
  if [ "$periodic" -gt 0 ] && [ "$now" -ge "$next_periodic" ]; then
    shot "t$(printf %03d "$now")"; next_periodic=$((next_periodic + periodic))
  fi
  while [ "$i" -lt "${#lines[@]}" ]; do
    read -r _ at verb arg1 arg2 <<< "${lines[$i]}"
    [ "$now" -ge "$at" ] || break
    case "$verb" in
      shot) shot "$arg1" ;;
      a) press a "${arg1:-120}"; log "t=$now A" ;;
      key) press "$arg1" "${arg2:-120}"; log "t=$now key $arg1" ;;
      hold) press "$arg1" "${arg2:-1000}"; log "t=$now hold $arg1 ${arg2:-1000}ms" ;;
      burst) burst "$arg1" "${arg2:-5}"; log "t=$now burst $arg1 ${arg2:-5}s" ;;
      *) log "unknown step: ${lines[$i]}" ;;
    esac
    sleep 0.4
    i=$((i + 1))
    now=$(( $(date +%s) - start ))
  done
  sleep 0.5
done
rc=0; wait "$pid" || rc=$?
wait
log "exited rc=$rc (124 = stopped by the timeout)"
