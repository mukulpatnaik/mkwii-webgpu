#!/usr/bin/env bash
# Serve a release folder (tools/hosting/stage-release.sh) with Caddy from a generated Caddyfile
# under work/hosting/caddy. Caddy gets its own certificate for a public hostname, so this is the
# one-command way to HTTPS plus a password on a machine reachable from the internet.
#
#   tools/hosting/serve-caddy.sh --site HOST [--root DIR] [--user NAME] [--check]
#
#   --site HOST     what to serve as: a hostname whose DNS points here (automatic HTTPS, ports 80
#                   and 443 must be reachable), or "localhost:8030"-style for a local check
#   --root DIR      folder to serve                     (default work/sites/release/public)
#   --user NAME     HTTP basic auth; the password is asked for (or MKW_PASSWORD in the environment)
#   --check         write and validate the Caddyfile, do not start
#
# Needs `caddy` (https://caddyserver.com/docs/install). Not run on the development machine (no
# Caddy there): the Caddyfile is validated by `caddy validate` where Caddy is installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${MKW_CADDY_RUN:-$ROOT/work/hosting/caddy}"
root="$ROOT/work/sites/release/public"; site=""; user=""; check=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site) site="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --user) user="$2"; shift 2 ;;
    --check) check=1; shift ;;
    -h|--help) sed -n 2,15p "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$site" ] || { echo "--site HOST is required (see --help)" >&2; exit 2; }
command -v caddy >/dev/null || { echo "caddy is not installed: https://caddyserver.com/docs/install" >&2; exit 1; }
[ -f "$root/WiiCompiled.html" ] || { echo "no WiiCompiled.html in $root: run tools/hosting/stage-release.sh" >&2; exit 1; }
root="$(cd "$root" && pwd)"

auth=""
if [ -n "$user" ]; then
  if [ -z "${MKW_PASSWORD:-}" ]; then
    read -r -s -p "Password for $user: " MKW_PASSWORD; echo
  fi
  [ -n "$MKW_PASSWORD" ] || { echo "empty password" >&2; exit 1; }
  hash="$(caddy hash-password --plaintext "$MKW_PASSWORD")"
  auth="basic_auth { $user $hash }"
fi

mkdir -p "$RUN"
sed -e "s|@SITE@|$site|g" -e "s|@ROOT@|$root|g" -e "s|@AUTH@|$auth|g" "$HERE/caddy/Caddyfile.in" > "$RUN/Caddyfile"
caddy validate --config "$RUN/Caddyfile" --adapter caddyfile
echo "Caddy: $site  serving $root  (Caddyfile $RUN/Caddyfile)"
[ -d "$root/game" ] && echo "game folder present: the page streams the extracted disc (fetch mode)" \
                    || echo "no game folder: players pick their own disc image"
[ "$check" = 1 ] && exit 0
exec caddy run --config "$RUN/Caddyfile" --adapter caddyfile
