#!/usr/bin/env bash
# Serve a release folder (tools/hosting/stage-release.sh) with nginx, unprivileged, from a
# generated configuration under work/hosting/nginx. For one machine and a few friends.
#
#   tools/hosting/serve-nginx.sh [--root DIR] [--port N] [--bind ADDR | --tailscale]
#                                [--user NAME] [--cert FILE --key FILE] [--check]
#
#   --root DIR      folder to serve                     (default work/sites/release/public)
#   --port N        port                                (default 8020)
#   --bind ADDR     address to listen on                (default 127.0.0.1: this machine only)
#   --tailscale     listen on this machine's Tailscale IPv4 (needs `tailscale`)
#   --user NAME     HTTP basic auth; the password is asked for (or MKW_PASSWORD in the environment)
#   --cert/--key    serve HTTPS with this certificate (for example from `tailscale cert`)
#   --check         write and test the configuration, do not start
#
# Anything other than 127.0.0.1 without --cert is plain HTTP, which browsers do not treat as a
# secure context: SharedArrayBuffer is unavailable and the game will not start. Put it behind
# `tailscale serve` (HTTPS, tailnet members only) or give it a certificate. See docs/hosting.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${MKW_NGINX_RUN:-$ROOT/work/hosting/nginx}"
mkdir -p "$RUN"; RUN="$(cd "$RUN" && pwd)"   # nginx resolves relative paths against its own prefix
root="$ROOT/work/sites/release/public"; port=8020; bind=127.0.0.1; user=""; cert=""; key=""; check=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --bind) bind="$2"; shift 2 ;;
    --tailscale) bind="$(tailscale ip -4)"; shift ;;
    --user) user="$2"; shift 2 ;;
    --cert) cert="$2"; shift 2 ;;
    --key) key="$2"; shift 2 ;;
    --check) check=1; shift ;;
    -h|--help) sed -n 2,18p "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
command -v nginx >/dev/null || { echo "nginx is not installed (Debian/Ubuntu: apt install nginx-core)" >&2; exit 1; }
[ -f "$root/WiiCompiled.html" ] || { echo "no WiiCompiled.html in $root: run tools/hosting/stage-release.sh" >&2; exit 1; }
root="$(cd "$root" && pwd)"
if [ -n "$cert$key" ] && { [ -z "$cert" ] || [ -z "$key" ]; }; then echo "--cert and --key go together" >&2; exit 1; fi

mkdir -p "$RUN/tmp"
cat > "$RUN/isolation.conf" <<'EOF'
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
add_header Cross-Origin-Resource-Policy same-origin always;
EOF

auth=""
if [ -n "$user" ]; then
  if [ -z "${MKW_PASSWORD:-}" ]; then
    read -r -s -p "Password for $user: " MKW_PASSWORD; echo
  fi
  [ -n "$MKW_PASSWORD" ] || { echo "empty password" >&2; exit 1; }
  (umask 077; printf '%s:%s\n' "$user" "$(openssl passwd -apr1 "$MKW_PASSWORD")" > "$RUN/htpasswd")
  auth="auth_basic \"Mario Kart Wii (private)\"; auth_basic_user_file $RUN/htpasswd;"
fi
ssl=""; tls=""
if [ -n "$cert" ]; then
  ssl=" ssl"
  tls="ssl_certificate $(cd "$(dirname "$cert")" && pwd)/$(basename "$cert"); ssl_certificate_key $(cd "$(dirname "$key")" && pwd)/$(basename "$key"); http2 on;"
fi

sed -e "s|@RUN@|$RUN|g" -e "s|@ROOT@|$root|g" -e "s|@BIND@|$bind|g" -e "s|@PORT@|$port|g" \
    -e "s|@SSL@|$ssl|g" -e "s|@TLS@|$tls|g" -e "s|@AUTH@|$auth|g" \
    "$HERE/nginx/mkw.conf.in" > "$RUN/nginx.conf"
nginx -t -q -c "$RUN/nginx.conf"

scheme=http; [ -n "$cert" ] && scheme=https
echo "nginx: $scheme://$bind:$port/WiiCompiled.html  serving $root  (config $RUN/nginx.conf)"
[ -d "$root/game" ] && echo "game folder present: the page streams the extracted disc (fetch mode)" \
                    || echo "no game folder: players pick their own disc image"
if [ "$bind" != 127.0.0.1 ] && [ "$bind" != "localhost" ] && [ -z "$cert" ]; then
  echo "WARNING: $bind over plain HTTP is not a secure context; the game will not start in a browser." >&2
  echo "         Use 'tailscale serve --bg --https=443 http://127.0.0.1:$port' with --bind 127.0.0.1, or --cert/--key." >&2
fi
[ "$check" = 1 ] && exit 0
exec nginx -c "$RUN/nginx.conf"
