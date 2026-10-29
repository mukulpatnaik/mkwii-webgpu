# Hosting the private build for friends

How the owner puts the page somewhere friends can open it. Each friend must own the game and
picks their own disc image in the page (read in their browser, never uploaded). The page files
contain translated game code, so the site is private: behind a login or a VPN, never on a public
address without one, never shared with people who do not own the game.

State on 2026-10-28. Scripts under `tools/hosting/`; evidence at the end.

## What a host has to do

Whatever serves the files must:

1. send `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
   and `Cross-Origin-Resource-Policy: same-origin` on every response (threads need
   `SharedArrayBuffer`, which browsers only give to a cross-origin isolated page);
2. answer HTTP range requests (a staged game folder is read in byte ranges; the disc reader and
   the `.wasm` are fetched whole);
3. serve `.wasm` as `application/wasm`;
4. be a **secure context**: HTTPS, or `127.0.0.1` / `localhost`. Plain `http://` on a LAN or VPN
   address is not one, and the page then stops with "This browser is missing: cross-origin
   isolation". This rules out "just open port 8000 on the LAN";
5. have access control. Cloudflare Access, a Tailscale network, or HTTP basic auth over HTTPS.

The release folder is six files (`tools/hosting/stage-release.sh`, with `SHA256SUMS`):

```text
WiiCompiled.html  WiiCompiled.js  WiiCompiled.wasm  WiiCompiled.data  mkw_disc.wasm  mkw_disc_worker.js
```

Without a `game/` folder next to them the page asks each player for their disc image. With
`stage-release.sh --with-game` the folder also links the owner's staged game folder (about 2.5 GB
of the extracted disc, `tools/stage-web.sh` in `work/mariokartwebtest`) and the page streams that
instead, so players need no disc. That puts disc files on the host: only do it behind access
control, for people who own the game. `?disc=local` and `?disc=fetch` force either mode.

Every option below starts with:

```bash
scripts/build-private-bundle.sh --skip-extract --skip-translate   # if build-web is not current
tools/hosting/stage-release.sh                                    # work/sites/release/public
tools/hosting/stage-release.sh --with-game work/sites/release-game/public   # optional fetch-mode folder
```

## Option 1: your own machine

### 1a. Tailscale (simplest for a few friends)

Serve on `127.0.0.1` and let Tailscale put HTTPS and identity in front of it. Friends join your
tailnet (invite them as users, or share the machine with their tailnet) and open the `ts.net`
address; nothing is reachable from the internet.

```bash
tools/hosting/serve-nginx.sh --port 8020                # or: work/dist/mkw-web-linux-x86_64 --no-open --port 8020
tailscale serve --bg --https=443 http://127.0.0.1:8020  # once; survives reboots
tailscale serve status                                  # shows https://<machine>.<tailnet>.ts.net
```

The address is `https://<machine>.<tailnet>.ts.net/WiiCompiled.html`. Tailscale issues the
certificate (so the page is a secure context) and only tailnet members can connect. `tailscale
serve` must not be confused with `tailscale funnel`, which exposes the port to the public internet:
never use funnel for this site.

Not verified on this machine (Tailscale is not installed here); the nginx part is.

### 1b. Caddy on a public hostname, with a password

For a machine reachable from the internet with a DNS name pointing at it and ports 80 and 443
forwarded. Caddy obtains a Let's Encrypt certificate by itself; the password is HTTP basic auth.

```bash
tools/hosting/serve-caddy.sh --site mkw.example.com --user friend     # asks for the password
```

Friends open `https://mkw.example.com/WiiCompiled.html` and log in with the shared user name and
password. One user is enough; the password can be changed by restarting with a new one.
`--check` only writes and validates `work/hosting/caddy/Caddyfile`.

Not verified on this machine (no Caddy installed; the Caddyfile is generated from
`tools/hosting/caddy/Caddyfile.in` and is validated by `caddy validate` where Caddy exists).

### 1c. nginx with your own certificate and a password

The same as 1b with nginx, when you already have a certificate (for example from
`tailscale cert <machine>.<tailnet>.ts.net`, or certbot). nginx runs unprivileged from a generated
configuration under `work/hosting/nginx`; nothing in `/etc/nginx` is touched.

```bash
tools/hosting/serve-nginx.sh --bind 0.0.0.0 --port 8443 --cert fullchain.pem --key privkey.pem --user friend
```

`serve-nginx.sh --help` lists the options; `--check` validates without starting. The plain
`127.0.0.1` form (no `--bind`, no certificate) is what 1a uses and what the evidence below tested.

## Option 2: Cloudflare (Worker + R2 + Access)

The page is served by a Worker (Minithena's `tools/cloudflare/worker.js` in
`work/mariokartwebtest`, unchanged) from a private R2 bucket, and Cloudflare Access puts a login
in front of the Worker. Nothing runs on your machine; friends anywhere can play. This is how
Minithena hosted their build.

You need: a Cloudflare account; R2 enabled on it (a payment method is required even though the
free tier, 10 GB stored and 10 million reads a month, covers this); Cloudflare Access (Zero
Trust, free for up to 50 users); Node (npx fetches wrangler 4). The page files are about 115 MB;
a `--with-game` folder adds about 2.5 GB of your disc to the bucket.

```bash
npx wrangler@4 login                                                     # once, opens the browser
tools/hosting/cloudflare/deploy.sh --worker mkw-web --bucket mkw-web --create --dry-run   # lists the upload
tools/hosting/cloudflare/deploy.sh --worker mkw-web --bucket mkw-web --create             # first time
tools/hosting/cloudflare/deploy.sh --worker mkw-web --bucket mkw-web                      # updates: changed files only
```

`deploy.sh` writes `work/hosting/cloudflare/wrangler.jsonc` for your names, deploys the Worker
(`https://mkw-web.<your-subdomain>.workers.dev`) and uploads the folder with Minithena's
`deploy-web.py` (now parametrised by `MKW_SITE_DIR`, `MKW_R2_BUCKET` and `MKW_WRANGLER_CONFIG`;
it uploads only what changed, recorded in `deployed.json` next to the folder).

Then, once, in the dashboard (Cloudflare attaches Access policies to a Worker since August 2026,
covering its `workers.dev` address as well as routes and custom domains):

1. Workers & Pages, your Worker, the Access tab.
2. Enable Access for all hostnames of the Worker (not only preview URLs).
3. Add an Allow policy with your friends' e-mail addresses (they log in with a one-time PIN sent
   to that address) or your identity provider. Allow nothing else.
4. In a private browser window the Worker's address must show a Cloudflare login page.

Deploy before the policy exists and the `.wasm` is public for that interval; do steps 1 to 4
right after the first deploy, or create the Worker and the policy first and deploy afterwards.
Access blocks WebSockets, which is why the separate room relay (`tools/cloudflare/rooms`) is not
behind it; it serves no game files.

Measured by Minithena from the US east coast against a Western Europe bucket: 0.4 to 0.5 s per
request, which is why a `--with-game` deployment loads races slowly from far away. Players'
own discs (the default) do not have that problem: only the 107 MB `.wasm` is downloaded, once.

Rehearsal without an account: `tools/hosting/cloudflare/dev-local.sh` loads the release folder
into wrangler's local R2 emulation and runs the same Worker on `127.0.0.1:8787`. That is what the
evidence below tested; a real deploy and Access were not exercised from here.

## What you supply, and what never leaves your machine

| You supply | Used by |
|---|---|
| A Tailscale account and the friends' invitations (1a) | `tailscale serve` |
| A DNS name pointing at your machine and forwarded ports 80/443 (1b), or a certificate (1c) | Caddy / nginx |
| A user name and password for basic auth (1b, 1c); say them to friends out of band | `--user` |
| A Cloudflare account with R2 and Zero Trust, `npx wrangler@4 login`, Worker and bucket names, friends' e-mail addresses (2) | `deploy.sh`, the dashboard |

The disc image is never part of a deployment. The `--with-game` folder is the extracted disc and
goes only to hosts behind access control.

## Evidence

Checked on this machine on 2026-10-28 with the 2026-10-17 build (fork `3d9da4d`), Chrome 156 on
a nested X display (functional checks; fps was measured in `docs/release-checklist.md`). Logs
under `tools/browser-test/out/hosting/` (gitignored: screenshots show the game).

| Path | Server | Checked |
|---|---|---|
| nginx, no game folder, player's disc | `serve-nginx.sh --port 8020` | curl: `application/wasm`, three isolation headers, 206 for `bytes=100-199` and `bytes=-50`, `/` serves the page, `POST /log` 204. Chrome: `[web-disc] opened RMCE01 (NTSC-U) ... main.dol ok, StaticR.rel ok`, `mounted 2012 game files ... from the local disc image`, title at `fps=60.0 over25/50/100=0/0/0` (`out/hosting/nginx-local`) |
| nginx with basic auth | `serve-nginx.sh --port 8021 --user friend` | curl: 401 without and with wrong credentials, 200 with the right ones. Chrome with `MKW_HTTP_USER`: same boot as above through the login, `fps=60.0` (`out/hosting/nginx-auth`) |
| nginx, staged game folder (fetch mode) | `serve-nginx.sh --port 8023 --root work/sites/release-game/public` | curl: `game/DATA/sys/fst.bin` 206 through the symlink with `Cache-Control: private, max-age=86400`. Chrome: `mounted 2012 game files at /game from the staged game folder`, 137 range responses in nginx's log during boot, `fps=60.0` (`out/hosting/nginx-fetch`) |
| nginx TLS and non-loopback binds | `--check` | configuration validates with `--cert/--key` (`listen ... ssl`, `http2 on`); `--bind 0.0.0.0` without a certificate prints the secure-context warning |
| Cloudflare Worker, local R2 emulation | `dev-local.sh` | curl: `application/wasm`, COEP, `Content-Length` 107400512, 206 ranges. Chrome: disc opened and mounted as with nginx, title at `fps=60.0` (`out/hosting/worker-local`). `node --test tools/cloudflare/test/worker.test.mjs`: 9 pass |
| Cloudflare deploy, dry run | `deploy.sh --dry-run` | 6 of 6 files (114 MB) without a game folder; 1896 files (2552 MB) with one |

In every run the browser's only 404s were the page's own probes for optional files
(`game/manifest-v2.txt` and `mkw-server-disc.json` on a site without them, `game/background.jpg`,
`favicon.ico`); they are how the page decides between a staged folder and the player's disc.

Not verified: Tailscale and Caddy (not installed here), a real Cloudflare deploy and the Access
policy, nginx over HTTPS with a real certificate, and play from a remote network.
