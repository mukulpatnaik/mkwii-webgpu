#!/usr/bin/env bash
# NTSC-U physics-parity run: the same time-trial ghost raced natively and in the web build, with
# the frames around the ghost's finish captured on both sides for a side-by-side check.
#
#   eval "$(scripts/new-track.sh e)"
#   scripts/parity/run-parity.sh [--no-native] [--no-web] [--no-stage] [--out DIR]
#
# 1. stages the native save into $SITE_DIR (scripts/parity/stage-save.sh)
# 2. native: Time Trials -> Luigi Circuit -> "Race This Ghost" with nobody driving, grabbing the
#    window while the ghost crosses the line (scripts/parity/native-run.sh + *.steps)
# 3. web: the same menus in Chrome against $SITE_DIR on $PORT (tools/browser-test/parity-drive.js)
# 4. writes contact sheets of both finish bursts and prints the comparison checklist
# Every GPU run holds /tmp/mkw-chrome.lock. Output goes to tools/browser-test/out/<track>/ (game-
# derived, gitignored). See docs/parity-ntsc-u.md for the human step and for other courses.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${FORK:?run eval \"\$(scripts/new-track.sh <track>)\" first}"
: "${SITE_DIR:?}" "${PORT:?}"
track="$(basename "$FORK" | sed 's/^wt-//')"
native=1; web=1; stage=1
out="$ROOT/tools/browser-test/out/$track/parity-$(date +%Y%m%d-%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-native) native=0 ;; --no-web) web=0 ;; --no-stage) stage=0 ;;
    --out) out="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
mkdir -p "$out"; out="$(cd "$out" && pwd)"
NATIVE_STEPS="${NATIVE_STEPS:-$ROOT/scripts/parity/native-race-staff-ghost.steps}"
WEB_STEPS="${WEB_STEPS:-$ROOT/scripts/parity/web-race-staff-ghost.steps}"
export DISPLAY="${DISPLAY:-:0}"

[ "$stage" = 0 ] || "$ROOT/scripts/parity/stage-save.sh" | tail -4

if [ "$native" = 1 ]; then
  echo "== native run (waits for the display lock)"
  PERIODIC=0 "$ROOT/scripts/parity/native-run.sh" 160 "$out/native" "$NATIVE_STEPS"
  grep -E "burst|exited" "$out/native/driver.log" || true
fi

if [ "$web" = 1 ]; then
  echo "== web run (waits for the display lock)"
  server=""
  if ! curl -fsI "http://127.0.0.1:$PORT/WiiCompiled.html" >/dev/null 2>&1; then
    python3 "$ROOT/tools/hosting/serve.py" "$SITE_DIR" --port "$PORT" > "$out/serve.log" 2>&1 &
    server=$!
    sleep 2
  fi
  ( cd "$ROOT/tools/browser-test" &&
    flock /tmp/mkw-chrome.lock node parity-drive.js "http://127.0.0.1:$PORT/WiiCompiled.html?muted&resetsave" \
      "$WEB_STEPS" "$out/web" 260 ) | grep -E "waitlog|burst|error|finished" || true
  [ -z "$server" ] || kill "$server"
fi

# Contact sheets: the distinct frames of each burst inside a window around the expected crossing
# (ms into the burst; the native burst starts ~2.8 s and the web one ~0.9 s before it), labelled
# with the burst offset.
sheet() {  # sheet <dir> <from-ms> <to-ms> <out.png>
  local dir="$1" from="$2" to="$3" png="$4" last="" f h n files=()
  [ -d "$dir" ] || return 0
  for f in "$dir"/*; do
    f="${f##*/}"
    n=$((10#${f%.*}))
    [ "$n" -ge "$from" ] && [ "$n" -le "$to" ] || continue
    h="$(md5sum < "$dir/$f" | cut -c1-12)"
    [ "$h" = "$last" ] || files+=("$dir/$f")
    last="$h"
  done
  [ "${#files[@]}" -gt 0 ] || return 0
  montage -label '%t' "${files[@]:0:96}" -tile 8x -geometry 320x+2+2 -pointsize 12 "$png" &&
    echo "contact sheet: $png (${#files[@]} distinct frames)"
}
sheet "$out/native/finish" "${NATIVE_SHEET_FROM:-2000}" "${NATIVE_SHEET_TO:-3800}" "$out/native-finish-sheet.png"
sheet "$out/web/finish" "${WEB_SHEET_FROM:-200}" "${WEB_SHEET_TO:-2000}" "$out/web-finish-sheet.png"

staff="$(grep -l . "$FORK"/Assets/DATA/files/Race/TimeAttack/ghost1/*.rkg 2>/dev/null | while read -r f; do
  python3 "$ROOT/scripts/parity/rkg-info.py" "$f"; done | grep "Luigi Circuit" | head -1 || true)"
cat <<EOF

== Parity checklist ($out)
Reference (ghost header): ${staff:-see scripts/parity/rkg-info.py on the ghost you raced}
[ ] native/04-ghosts.png and web/04-ghosts.png show the same ghost and time on the Ghosts screen
[ ] web/01-licence-select.png shows the native licence (the staged save was read)
[ ] in both finish sheets the ghost's front wheels reach the checkered line when the HUD timer
    reads the reference finish time, give or take two frames (~35 ms; the timer readings are not
    on a 1/60 s grid, so compare positions at matching readings rather than single digits)
[ ] at matching timer readings (within ~6 ms) the ghost is in the same place on screen in both
[ ] web console.log: no [pageerror]/[crash]; [web-pace] race steps/s=60.0 during the race
A ghost that has diverged is obvious: it reaches the line seconds early or late, or not at all.
EOF
