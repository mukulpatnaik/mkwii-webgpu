#!/usr/bin/env bash
# Clone the upstream repositories this project studies/contributes to, at the SHAs
# recorded in docs/research-browser-port.md. Pass --latest to skip the pin.
set -euo pipefail
cd "$(dirname "$0")/.."; mkdir -p upstream; cd upstream
clone() { # name url sha
  [ -d "$1" ] || git clone --recursive -q "$2" "$1"
  [ "${PIN:-1}" = 1 ] && git -C "$1" checkout -q "$3" || true
}
[ "${1:-}" = "--latest" ] && PIN=0
clone Wiicompiled    https://github.com/patchzyy/Wiicompiled.git         9d182f831618235b0cf74ab891b8c3440b658e30
clone aurora         https://github.com/encounter/aurora.git             77997d4591df5196bd81e5cc758a430864111988
clone melee-pc       https://github.com/999sian/melee-pc.git             e83383539a4fd06e9bd8b28c270b3d1ecc7d3be3
clone wiicompiledweb https://github.com/OtherShindo957/WiicompiledWeb.git e1e4ba0c4de76f66ad9be11baf2b7d5e4ec9a282
clone goldenballoon  https://github.com/akratch/goldenballoon.git        106bad37244a2f8829bab21c655d25ff4b4dcdbf
# Minithena/mariokartwebtest (page tooling, room relay; studied in docs/research-browser-port.md)
# vanished from GitHub by 2026-10-28 and carried no licence, so it is not cloned or vendored here.
# The working fork is this repository's submodule at work/Wiicompiled (git submodule update --init).
# It started from Minithena/Wiicompiled `web`; to compare with the originals, add them as remotes:
#   git -C work/Wiicompiled remote add patchzyy https://github.com/patchzyy/Wiicompiled.git
#   git -C work/Wiicompiled remote add minithena https://github.com/Minithena/Wiicompiled.git
clone nod            https://github.com/encounter/nod.git                ebd80cac99b48a323200d84365e07a58cc27412d
