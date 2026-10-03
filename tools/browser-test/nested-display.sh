#!/usr/bin/env bash
# Start (if needed) a nested X display with Xephyr and print its DISPLAY value, so a Chrome test
# can run in its own contained window instead of on the desktop.
#
#   export DISPLAY=$(./nested-display.sh 6)      # :6, 1280x900
#
# Chrome inside it still gets the real GPU through Vulkan (WebGPU adapter "nvidia lovelace",
# not a fallback), and the game runs, but every frame is copied to the outer display in software:
# present times are higher, so use it for functional tests and keep timing measurements on :0.
# Headless Chrome does not get a WebGPU adapter on this machine.
set -euo pipefail
n="${1:?usage: $0 <display-number>}"
if ! [ -e "/tmp/.X11-unix/X$n" ]; then
  DISPLAY="${OUTER_DISPLAY:-:0}" setsid Xephyr ":$n" -screen 1280x900 -br -ac -nolisten tcp \
    -title "mkw test :$n" >"/tmp/xephyr-$n.log" 2>&1 < /dev/null &
  for _ in $(seq 50); do [ -e "/tmp/.X11-unix/X$n" ] && break; sleep 0.1; done
fi
[ -e "/tmp/.X11-unix/X$n" ] || { echo "Xephyr :$n did not start (see /tmp/xephyr-$n.log)" >&2; exit 1; }
echo ":$n"
