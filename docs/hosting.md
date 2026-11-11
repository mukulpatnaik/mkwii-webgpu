# Hosting the build

How the owner puts the page somewhere people can open it. Each player picks their own disc
image in the page (read in their browser, never uploaded). The page files contain translated game
code (and the game's data sections), and until 2026-11-09 the site was private, behind a login;
since then the owner hosts it at a public address (README, "Legal"). The login setup is kept
below for anyone who wants a private build.

State on 2026-10-29. Scripts under `tools/hosting/` (all this project's own: the Worker, the
uploader, a local server, game-folder staging); evidence at the end.

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
5. for a private build, have access control: Cloudflare Access, a Tailscale network, or HTTP basic
   auth over HTTPS. The owner's build is public and has none.

The release folder is six files (`tools/hosting/stage-release.sh`, with `SHA256SUMS`):

```text
WiiCompiled.html  WiiCompiled.js  WiiCompiled.wasm  WiiCompiled.data  mkw_disc.wasm  mkw_disc_worker.js
```

Without a `game/` folder next to them the page asks each player for their disc image. With
`stage-release.sh --with-game` the folder also links the owner's staged game folder (about 2.5 GB
of the extracted disc, written by `tools/hosting/stage-game.sh`) and the page streams that
instead, so players need no disc. That puts disc files on the host: only do it behind access
control, for people who own the game. `?disc=local` and `?disc=fetch` force either mode.

Every option below starts with:

```bash
scripts/build-private-bundle.sh --skip-extract --skip-translate   # if build-web is not current
tools/hosting/stage-release.sh                                    # work/sites/release/public
tools/hosting/stage-game.sh                                       # optional: work/sites/game (the extracted disc, manifests)
tools/hosting/stage-release.sh --with-game work/sites/release-game/public   # optional fetch-mode folder
```

A quick local check of any staged folder: `tools/hosting/serve.py work/sites/release/public`
(127.0.0.1 only, the right headers and ranges, no access control).

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

## Option 2: Cloudflare (Worker + R2, Access optional)

The page is served by a Worker (`tools/hosting/cloudflare/worker.js`, unit tests next to it) from
a private R2 bucket; Cloudflare Access can put a login in front of the Worker. Nothing runs on
your machine; anyone can play. This is the shape Minithena used for their build, with Access.

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
(`https://mkw-web.<your-subdomain>.workers.dev`) and uploads the folder with
`tools/hosting/cloudflare/upload-r2.py` (only what changed, recorded in `deployed.json` next to
the folder; a page or manifest is uploaded after the files it names). `--no-upload` deploys the
Worker with the bucket still empty, so Access can be put in front of it before any file exists.

For a private build, once, in the dashboard (Cloudflare attaches Access policies to a Worker
since August 2026, covering its `workers.dev` address as well as routes and custom domains):

1. Workers & Pages, your Worker, the Access tab.
2. Enable Access for all hostnames of the Worker (not only preview URLs).
3. Add an Allow policy with your friends' e-mail addresses (they log in with a one-time PIN sent
   to that address) or your identity provider. Allow nothing else.
4. In a private browser window the Worker's address must show a Cloudflare login page.

Deploy before the policy exists and the `.wasm` is public for that interval; do steps 1 to 4
right after the first deploy, or create the Worker and the policy first and deploy afterwards.
Access blocks WebSockets, which is why the room relay for online play runs as a separate Worker
outside it; it serves no game files (see "Online play" below).

To make a private Worker public again, the same Access tab: disable Access for the Worker (or
delete its Access application under Zero Trust, Access, Applications). Then, in a private browser
window, the Worker's address must show the page itself, not a login; `curl -sI` on
`/WiiCompiled.html` must answer `200` with the three cross-origin headers, not a `302`. The
owner's build has been public since 2026-11-09.

Measured by Minithena from the US east coast against a Western Europe bucket: 0.4 to 0.5 s per
request, which is why a `--with-game` deployment loads races slowly from far away. Players'
own discs (the default) do not have that problem: only the 107 MB `.wasm` is downloaded, once.

Rehearsal without an account: `tools/hosting/cloudflare/dev-local.sh` loads the release folder
into wrangler's local R2 emulation and runs the same Worker on `127.0.0.1:8787`.

## Online play: the room relay

Online races go through a room relay: each invite is one Cloudflare Durable Object; the game's
Nintendo WFC traffic (TCP) and the race's peer packets (UDP) travel over one WebSocket per player
to it, and it answers as the matchmaking server itself, so only the people holding the invite can
meet, and nothing contacts Nintendo or Wiimmfi. It serves no game files. The relay is Minithena's
`tools/cloudflare/rooms` Worker, vendored unchanged as [`tools/relay/`](../tools/relay/). It is
**AGPL-3.0-only** (its own [LICENSE](../tools/relay/LICENSE)), not GPLv3 like the rest of this
project, and it is a separate program: the page only talks to it over WebSockets. Its README
describes the protocol and the lobby endpoint.

Locally nothing needs an account. A page served from `127.0.0.1` or `localhost` connects to
`ws://127.0.0.1:8787`, which is where this runs it (wrangler's local Durable Object emulation;
state and scratch files under `work/relay/`):

```bash
tools/relay/dev-local.sh --trace                             # Ctrl+C stops it; --trace logs player-to-player packet rates
node --test tools/relay/test/rooms.test.mjs                  # unit tests (also in CI)
node tools/relay/test/live-smoke.mjs http://127.0.0.1:8787   # protocol smoke test against the running relay
```

Then open the page in two browsers that do not share a save (two Chrome profiles, or `127.0.0.1`
for one player and `localhost` for the other), **Create room** in one, **Join room** with the code
(or open the copied invite link) in the other, set a name, and **Play online** in both: the game
connects to the room, logs in, opens character selection, and the two players match each other
and race. Each player needs a game profile (a licence with a Mii) in that browser first; a fresh
browser makes one through the game's own setup screens. `tools/browser-test/room-test.js` does
all of this with two real Chrome clients on two nested displays (see "Evidence").

For a hosted site the relay is deployed to your own Cloudflare account as a second Worker, next
to the page Worker but **not** behind Access (Access blocks WebSockets; the relay has no game
files, and the long random invite code is the only key):

```bash
cd tools/relay && npx wrangler@4 deploy      # -> https://mkw-rooms.<your-subdomain>.workers.dev
```

and the page is told where it is when the release folder is staged:

```bash
tools/hosting/stage-release.sh --rooms-host mkw-rooms.<your-subdomain>.workers.dev
```

That sets the page's `<meta name="mkw-rooms-host">` tag, which the fork's `shell.html` reads for
any page not served from `127.0.0.1`/`localhost`. `?room=ws://host/v1/rooms/<code>/ws` on the page
overrides both the local and the hosted choice, for diagnostics.

**This project's relay** is `https://mkw-rooms.mukulpatnaik.workers.dev`, deployed on 2026-11-11
from the Linux build machine with `npx wrangler@4 deploy` in `tools/relay` (wrangler 4.160.0, the
owner's account; `live-smoke.mjs` against it: PASS). It is the tag's built-in value since fork
`ac140ab`; before that the built-in value was Minithena's `mkw-rooms.athenaaa.workers.dev`, which
mkwii.online used until the page upload recorded under "Evidence". Its use, and how close it is to the
account plan's limits, is in the Cloudflare dashboard under Workers, `mkw-rooms`. A page served from
`<name>.localhost` (Chrome resolves it to this machine and treats it as secure) uses the hosted
relay, which is how a local game folder can test it.

## What you supply, and what never leaves your machine

| You supply | Used by |
|---|---|
| A Tailscale account and the friends' invitations (1a) | `tailscale serve` |
| A DNS name pointing at your machine and forwarded ports 80/443 (1b), or a certificate (1c) | Caddy / nginx |
| A user name and password for basic auth (1b, 1c); say them to friends out of band | `--user` |
| A Cloudflare account with R2 and Zero Trust, `npx wrangler@4 login`, Worker and bucket names, friends' e-mail addresses (2) | `deploy.sh`, the dashboard |
| For online play: the relay deployed to the same account (`npx wrangler@4 deploy` in `tools/relay`) and its host name | `stage-release.sh --rooms-host` |

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
| nginx, staged game folder (fetch mode) | `serve-nginx.sh --port 8023 --root work/sites/release-game/public` | curl: `game/DATA/sys/fst.bin` 206 through the symlink with `Cache-Control: private, max-age=86400`. Chrome: `mounted 2012 game files at /game from the staged game folder`, 137 range responses in nginx's log during boot, `fps=60.0` (`out/hosting/nginx-fetch`, 2026-10-28, Minithena's staging). Again on 2026-10-29 with the folder from `tools/hosting/stage-game.sh` (2012 files, 125 in one 2.3 MB pack): same mount line, the pack fetched, 98 range responses, `fps=60.0` (`out/hosting/nginx-fetch-own`) |
| `tools/hosting/serve.py`, staged game folder | `serve.py work/sites/release-game/public --port 8032` | curl: 302 from `/`, `application/wasm`, three isolation headers, 206 for `bytes=100-199` (bytes compared with `dd`) and `bytes=-50`, 416 past the end, `//WiiCompiled.html` normalised, `../` and `%2e%2e` paths 404, `POST /log` 204 and printed. Chrome from `/?muted`: `mounted 2012 game files ... staged game folder`, 97 range responses, `fps=60.0` (`out/hosting/serve-py-own`) |
| nginx TLS and non-loopback binds | `--check` | configuration validates with `--cert/--key` (`listen ... ssl`, `http2 on`); `--bind 0.0.0.0` without a certificate prints the secure-context warning |
| Cloudflare Worker, local R2 emulation | `dev-local.sh` | curl: `application/wasm`, COEP, `Content-Length` 107400512, 206 ranges. Chrome: disc opened and mounted as with nginx, title at `fps=60.0` (`out/hosting/worker-local`, Minithena's Worker on 2026-10-28; `out/hosting/worker-local-own`, this project's Worker on 2026-10-29). `node --test tools/hosting/cloudflare/worker.test.mjs`: 10 pass |
| Cloudflare deploy, dry run | `deploy.sh --dry-run` | 6 of 6 files (114 MB) without a game folder; 1896 files (2552 MB) with one |
| Real Cloudflare deploy behind Access | `deploy.sh --create --no-upload`, Access enabled in the dashboard, then `deploy.sh` | 2026-10-29: Worker and bucket created, Access (one-time PIN, Allow policy on named e-mails) attached to all hostnames, then 6 files (114 MB) uploaded; three objects fetched back through the R2 API hash-match the staged files; anonymous requests to every path, `/log` included, get a 302 to the Access login and nothing else. Later the same day the Worker was redeployed with this project's `worker.js` (`deploy.sh --no-upload`, version `357c596e`); anonymous GET, HEAD and `POST /log` on every path still get only the 302. On 2026-10-30 the restyled page (fork `e4dce14`, Wii Menu light and Disc Channel dark looks) was uploaded with a plain `deploy.sh`: 3 of 6 files changed (107.9 MB), the three fetched back through the R2 API hash-match the staged files, and anonymous requests still get only the 302. Not yet checked: a Chrome boot through the login from this machine (the test window timed out before the PIN) and play from a remote network |
| Page-only upload to the public site | `npx wrangler@4 r2 object put mkw-web/WiiCompiled.html --file WiiCompiled.html --remote` | 2026-11-10, second upload: the Wii Menu page (fork `1c0db25`: two tiles, the curved bar, channel screens, the drawn wordmark; 75,989 bytes, sha256 `0e4bb234…d45527d0`) replaced that one object; the other five files and the Worker were not touched, and no `game/` folder was involved. The page is `shell.html` with Emscripten's loader tag in place of `{{{ SCRIPT }}}` (`<script async type="text/javascript" src="WiiCompiled.js"></script>`), minified by html-minifier-terser 7.2.0 with Emscripten's option list (collapse-whitespace, remove-comments, remove-tag-whitespace, sort-attributes, sort-class-name, decode-entities, collapse-boolean-attributes, remove-attribute-quotes, remove-redundant-attributes, remove-script-type-attributes, remove-style-link-type-attributes, use-short-doctype, minify-css, minify-js); the same steps on fork `b17104e` give the earlier upload byte for byte (sha256 `d09a036f…372ebf22`), which is what the bucket held before. Read back from the bucket, from the Worker's `workers.dev` address and from its custom domain: all three byte-identical to the uploaded file; on both addresses `200`, `text/html`, the three cross-origin headers, and `/` redirects to the page. In a browser on the custom domain: `crossOriginIsolated` true, the disc screen with the wordmark and the Help pill, "Game loaded". Before the upload the same file ran locally from `serve.py` on a `--with-game` folder: fork tests 145 pass, 10 skipped; the tiles, then Play solo and Start booted the game at `fps=60.0`, and the bindings, saves and help blocks moved to the controls panel. Not checked: picking a disc image on the live site (no disc image on this machine), the light theme on the live site (the test browser prefers dark; light was checked on a local copy), and a room through the hosted relay. Earlier the same day: the page with the disc-first start screen and the four-item menu (fork `b17104e`, 67,919 bytes), uploaded and checked the same way |
| Own room relay on the public site | `npx wrangler@4 deploy` in `tools/relay`; then `tools/hosting/stage-release.sh --rooms-host mkw-rooms.mukulpatnaik.workers.dev` and `upload-r2.py` as for a runtime update | 2026-11-11, from the Linux build machine: the relay Worker `mkw-rooms` deployed to the owner's account (wrangler 4.160.0, version `b3b43434`; no Worker of that name existed before), relay unit tests 17 pass, `node tools/relay/test/live-smoke.mjs https://mkw-rooms.mukulpatnaik.workers.dev` PASS. Fork `ac140ab` makes it the page's built-in relay host (the page tests 149 pass, 10 skipped); built with `--skip-extract --skip-translate` (50 s, the `.wasm` unchanged). A full online race through it before the upload: the release folder staged `--with-game --rooms-host mkw-rooms.mukulpatnaik.workers.dev`, served on port 8040 and opened as `http://mkwii.localhost:8040` (a `.localhost` page uses the hosted relay; nothing listened on 8787), `tools/browser-test/room-test.js` with two Chrome profiles on the build machine's display: A created room `h3udsfxj4kcy`, B joined, `[vnet] joined the room as 10.77.0.1` / `10.77.0.2`, character selection on both, both loaded Luigi Circuit and raced at `fps=59.3` / `59.7`, PASS. The upload sent 1 changed file of 6: `WiiCompiled.html` (sha256 `3b52dfca…71994f3f`, the tag `mkw-rooms-host` = `mkw-rooms.mukulpatnaik.workers.dev`); fetched back from both addresses byte-identical, `200`, the cross-origin headers. In a browser on the custom domain: `crossOriginIsolated` true, and a lobby WebSocket opened from that page to the relay got its welcome and a roster with the name it set. Until this upload mkwii.online sent rooms to Minithena's `mkw-rooms.athenaaa.workers.dev`. Not checked: a room created from the live page with a disc picked in it, two players on different networks. |
| Runtime update on the public site | `tools/hosting/stage-release.sh`, then `python3 tools/hosting/cloudflare/upload-r2.py --site work/sites/release/public --bucket mkw-web --config work/hosting/cloudflare/wrangler.jsonc` (no `--deploy-worker`) | 2026-11-10, third runtime update, from the Linux build machine: fork `6e3aa4b`, the commit this repository pins (the fork is a submodule since `8af3c47`). It adds four fixes taken from patchzyy/Wiicompiled (the NTSC-U function map of #346, ten functions reached only through vtables that were never translated; display lists dropping draws, #288; unsourced TEV konst selectors, #303; the audio poll remainder, #360) and the tab title "Mario Kart Wii". The map change needs a new translation: `scripts/build-private-bundle.sh --skip-extract` (67 s on top of the earlier output; 249 s from nothing in a track), 29456 functions instead of 29446, then `--skip-extract --skip-translate` for the title (35 s). The release folder is byte-identical to the build that was tested. The uploader sent the 3 changed files of 6 (108.0 MB, 44 s): `WiiCompiled.html` (93,673 bytes, sha256 `8c9edae2…e0621c0f`), `WiiCompiled.js` (`ff692945…3752a7e0`) and `WiiCompiled.wasm` (107,488,066 bytes, `1583868c…c368c768`); the Worker was not redeployed. Fetched back from both addresses: all three byte-identical, `200`, the three cross-origin headers, `<title>Mario Kart Wii</title>`. In a browser on the custom domain: `crossOriginIsolated` true, the disc screen, "Game loaded", the tab titled "Mario Kart Wii". Before the upload, on the same build served from a folder with a game, `tools/browser-test/pace-drive.js` with `routes/gp-50cc.cmds` in Chrome on the build machine's display (the first run of the drivers on Linux since the Wii Menu page): a fresh profile to the first 50cc Grand Prix race, `[web-perf] fps=60.0` in the race, no error in the console, `document.title` "Mario Kart Wii" during the race; the fork's CI and the graphics unit tests (251, with the new display-list test) pass. Not checked: the stop the map fix is for was not reproduced before or after (the evidence is the ten functions in the translation), picking a disc image on the live site, a room through the hosted relay. Earlier the same day, the second runtime update: fork `64b3d93` (browser pads recognised and named, printed A/B on Switch pads, the Controls card with a controller drawing and a tab for the pad) built with `scripts/build-private-bundle.sh --skip-extract --skip-translate` (46 s) and staged; the release folder is byte-identical to the build that was tested. The uploader sent the 3 changed files of 6 (107.9 MB, 12 s): `WiiCompiled.html` (93,670 bytes, sha256 `72d5f929…08b59590`), `WiiCompiled.js` (`d6d9aa05…da0210a3`) and `WiiCompiled.wasm` (107,409,289 bytes, `d6d2046f…6bff4f86`); the Worker was not redeployed. Fetched back from both addresses: all three byte-identical, `200`, the three cross-origin headers. In a browser on the custom domain: `crossOriginIsolated` true, the disc screen, "Game loaded". Before the upload, on the same build served from a folder with a game and with a simulated Switch Pro Controller (standard mapping, 057e:2009, in Chrome on macOS): the Controls card opened on the pad's tab with its buttons in Switch names, a rebind from the card took the pad's left bumper, the right button confirmed at the title screen and the bottom one went back; fork tests 149 pass, 10 skipped. Not checked: a real controller, Joy-Cons, picking a disc image on the live site, a room through the hosted relay. Earlier the same day: fork `d1b7ed8` (the corner button and pill in the game, the arrow keys as the default keyboard layout) built with `scripts/build-private-bundle.sh --skip-extract --skip-translate` (49 s, incremental) and staged. The uploader sent the 3 changed files of 6 (107.9 MB, 14 s): `WiiCompiled.html` (81,640 bytes, sha256 `0ee5a739…f9a6230f`), `WiiCompiled.js` (`cbcd1718…467be3c3`) and `WiiCompiled.wasm` (107,401,279 bytes, `34130fdd…af9094df`); the Worker was not redeployed, since its custom domain was attached in the dashboard. Fetched back from the `workers.dev` address and the custom domain: all three byte-identical to the release folder, `200`, the three cross-origin headers. In a browser on the custom domain: `crossOriginIsolated` true, the disc screen, the new key list, "Game loaded". Before the upload the same build ran from `serve.py` on the folder with a game: on a new profile the game reported the arrow layout, X left the title screen, the right arrow moved the licence selection, Z went back, a mouse click no longer pressed A, and `?layout=wasd` / `?layout=arrows` switched presets; fork tests 147 pass, 10 skipped. Not checked: picking a disc image on the live site, a race on the new keys, a room through the hosted relay, and the browser test drivers (edited on a Mac, not run) |

| Online play, two clients through the local relay | `tools/relay/dev-local.sh --trace`, `serve.py` on a `--with-game` folder, `tools/browser-test/room-test.js` on two nested displays | 2026-10-29, fork at the commit this was written with (NTSC-U build): relay unit tests 17 pass, `live-smoke.mjs` PASS against wrangler dev. Two fresh Chrome profiles: each created a game profile through the game's setup screens; A `Create room`, B `Join room` with the code; the lobby roster showed both names on both pages; `Play online` in both gave `[vnet] joined the room as 10.77.0.1` / `10.77.0.2`, the relay's `[wfc] NAS login`, `GPCM login` and `logged in as profile` lines for both, `[room-launch] login complete; matching page activated` and `character selection ready` on both; after character, vehicle and drift the game's Check Members screen listed Alice and Bob, both voted, and both loaded Luigi Circuit (`[web-warm] course file beginner_course.szs` on both, each other's name tag in the race, roster `In game` for both) at `[web-pace] race steps/s=60.0` and `[web-perf] fps=60.0`, with the relay logging about 65-70 packets per 2 s in each direction (`out/relay/run4`, `run5`). The first NTSC-U attempt stopped at "Your saved profile needs attention": NTSC-U queues its ESRB notice before the title, which the launcher now accepts (fork change) |

In every run the browser's only 404s were the page's own probes for optional files
(`game/manifest-v2.txt` and `mkw-server-disc.json` on a site without them, `game/background.jpg`,
`favicon.ico`); they are how the page decides between a staged folder and the player's disc.

Not verified: Tailscale and Caddy (not installed here), nginx over HTTPS with a real certificate,
play from a remote network, and the relay deployed to Cloudflare (only wrangler's local emulation
was run; the deploy command is in "Online play").
