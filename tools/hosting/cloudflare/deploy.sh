#!/usr/bin/env bash
# Host the release folder on Cloudflare: a Worker (Minithena's tools/cloudflare/worker.js) in
# front of a private R2 bucket, protected by Cloudflare Access. This script prepares your
# wrangler config and uploads; it never changes Access itself (that is a dashboard step, printed
# at the end).
#
#   tools/hosting/cloudflare/deploy.sh --worker NAME --bucket NAME [--site DIR] [--create] [--dry-run]
#
#   --worker NAME   your Worker's name (its address is https://NAME.<your-subdomain>.workers.dev)
#   --bucket NAME   your R2 bucket (private; created with --create the first time)
#   --site DIR      the release folder to upload       (default work/sites/release/public)
#   --create        create the bucket first (`wrangler r2 bucket create`)
#   --dry-run       list what would be uploaded, upload nothing, deploy nothing
#
# Needs: Node (npx fetches wrangler 4), a Cloudflare account with R2 enabled, and one
# `npx wrangler@4 login`. Costs: R2's free tier holds 10 GB; the page files are about 115 MB. A
# staged game folder (--with-game at staging) adds about 2.5 GB of your disc to the bucket.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLING="$ROOT/work/mariokartwebtest"
RUN="${MKW_CF_RUN:-$ROOT/work/hosting/cloudflare}"
worker=""; bucket=""; site="$ROOT/work/sites/release/public"; create=0; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --worker) worker="$2"; shift 2 ;;
    --bucket) bucket="$2"; shift 2 ;;
    --site) site="$2"; shift 2 ;;
    --create) create=1; shift ;;
    --dry-run) dry=1; shift ;;
    -h|--help) sed -n 2,18p "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$worker" ] && [ -n "$bucket" ] || { echo "--worker NAME and --bucket NAME are required" >&2; exit 2; }
[[ "$worker" =~ ^[a-z0-9][a-z0-9-]*$ && "$bucket" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "names: lowercase letters, digits, dashes" >&2; exit 2; }
[ -f "$TOOLING/tools/cloudflare/worker.js" ] || { echo "no Worker at $TOOLING/tools/cloudflare/worker.js" >&2; exit 1; }
[ -f "$site/WiiCompiled.html" ] || { echo "no WiiCompiled.html in $site: run tools/hosting/stage-release.sh" >&2; exit 1; }
site="$(cd "$site" && pwd)"

mkdir -p "$RUN"
sed -e "s|@WORKER@|$worker|g" -e "s|@BUCKET@|$bucket|g" -e "s|@WORKER_JS@|$TOOLING/tools/cloudflare/worker.js|g" \
    "$HERE/wrangler.jsonc.in" > "$RUN/wrangler.jsonc"
export MKW_SITE_DIR="$site" MKW_R2_BUCKET="$bucket" MKW_WRANGLER_CONFIG="$RUN/wrangler.jsonc"
echo "Worker $worker, bucket $bucket, site $site (config $RUN/wrangler.jsonc)"

if [ "$dry" = 1 ]; then
  python3 "$TOOLING/tools/deploy-web.py" --dry-run
  echo "Dry run: nothing deployed. Without --dry-run this would run:"
  [ "$create" = 1 ] && echo "  npx wrangler@4 r2 bucket create $bucket"
  echo "  npx wrangler@4 deploy --config $RUN/wrangler.jsonc"
  echo "  python3 $TOOLING/tools/deploy-web.py          # uploads changed files to R2"
  exit 0
fi

if [ "$create" = 1 ]; then
  (cd "$RUN" && npx --yes wrangler@4 r2 bucket create "$bucket")
fi
python3 "$TOOLING/tools/deploy-web.py" --worker
cat <<EOF

Deployed. Before sharing the address, put the Worker behind Cloudflare Access (one-time, dashboard):
  1. https://dash.cloudflare.com -> Workers & Pages -> $worker -> the Access tab (or Settings).
  2. Enable Access for ALL hostnames of the Worker (not just previews), so the workers.dev
     address is covered.
  3. Policy: Allow, with the e-mail addresses of your friends (one-time PIN login) or your
     identity provider. Nothing else should be allowed.
  4. Check in a private window: https://$worker.<your-subdomain>.workers.dev must show a
     Cloudflare login page, not the game.
Then tell your friends the address; they pick their own disc image in the page.
EOF
