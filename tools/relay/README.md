# Room relay for online play (AGPL-3.0, vendored)

This folder is Minithena's (Athena's) room relay, `tools/cloudflare/rooms` of their
`mariokartwebtest` repository, copied unchanged from that repository's last state (commit
`1bea98c`; the folder was last changed in `b1e1aee`, 2026-10-01) after it left GitHub. It is
**AGPL-3.0-only** ([LICENSE](LICENSE)): the one part of that repository that carried a licence,
and the one part of this project that is not GPLv3. Nothing else of that repository is here.
Their README follows below, unchanged; where it says `tools/cloudflare/rooms` read this folder,
and "the game page" is `runtime/src/platform/web/shell.html` in the WiiCompiled fork, whose
"Room server source" link points here.

In this project (added files: this section, `dev-local.sh`, `.gitignore`):

```sh
node --test tools/relay/test/rooms.test.mjs        # unit tests; .github/workflows/checks.yml runs them
tools/relay/dev-local.sh [--port 8787] [--trace]   # wrangler dev on 127.0.0.1:8787, local Durable Objects, no account
node tools/relay/test/live-smoke.mjs http://127.0.0.1:8787   # protocol smoke test against a running relay
tools/browser-test/room-test.js                    # two real Chrome clients race through it (see its header)
```

A page served from `127.0.0.1` or `localhost` uses `ws://127.0.0.1:8787`; a hosted page uses the
host named in its `<meta name="mkw-rooms-host">` tag, and `?room=ws://...` on the page overrides
both. Deploying to your own Cloudflare account is `npx wrangler@4 deploy` in this folder (the
Worker is called `mkw-rooms` and gets `https://mkw-rooms.<your-subdomain>.workers.dev`); it must
not be put behind Cloudflare Access, which blocks WebSockets, and it serves no game files. See
`docs/hosting.md`, "Online play".

---

# Private multiplayer rooms

This Worker hosts a room relay and a small Nintendo WFC protocol implementation. It serves no
game files. Each invite gets an isolated Durable Object; a player can only send game packets to
players in that room. A room accepts at most 12 participants; each can hold a lobby and a game socket.

The game speaks its original WFC matchmaking and peer protocols. Virtual sockets in the
WiiCompiled web runtime carry those packets over WSS to this Worker. Race packets are relayed
over WebSockets; this implementation does not use WebRTC or connect to Nintendo/Wiimmfi.

The lobby endpoint `GET /v1/rooms/<code>/lobby` accepts a text WebSocket. It first sends
`{"type":"welcome","id":<number>,"token":"<private session token>"}`. Send
`{"type":"name","name":"<display name>"}` to set a bounded display name, then read
`{"type":"roster","players":[{"id":<number>,"name":"...","inGame":<boolean>}],"capacity":12}`
updates. The private token is only for the player's own session and is never included in a roster.
Open the game socket at `/v1/rooms/<code>/ws?token=<token>` to use the same reserved player slot;
game clients that do not use a lobby token can still join directly. A slot remains reserved while
either its lobby or game socket is connected, and the room's limit of 12 counts both kinds of
participants.

```sh
npm install
npm test
npm run dev
# After validation:
npm run deploy
```

With the service running, `node test/live-smoke.mjs http://127.0.0.1:8787` checks real WebSocket
admission, NAS login and GameSpy proof, two clients with the same seeded account, 360 relayed
datagrams, and room isolation. Pass the deployed HTTPS origin to run the same smoke test there.

For a local game served on port 8000, create a room in the controls sidebar. Open its invite in
two independent browser profiles (or use `127.0.0.1` for one player and `localhost` for the other).
Each player chooses **Nintendo WFC → Worldwide → VS Race** in the game. Despite the menu label,
matchmaking is restricted to the invite's room. Saves remain in each browser's own storage.

The hosted game still requires the existing Cloudflare Access login. Keep that protection on;
the separate room Worker contains no disc data and uses unguessable invite codes for admission.
Do not publish game assets, generated translation files, or the compiled game in either repo.

For packet-rate diagnostics, start Wrangler with `--var TRACE_TRAFFIC:1`. Room and profile data
are temporary and are removed when players leave; a Worker restart disconnects active rooms.

## Licence and provenance

The room server is AGPL-3.0-only; see [LICENSE](LICENSE). The game page links to its published
source. `src/enctypex.js` is adapted from WiiLink WFC's `common/encryption.go`; `src/wfc.js` follows
the protocols implemented by these AGPL projects:

- [WiiLink24/wfc-server](https://github.com/WiiLink24/wfc-server), reference commit
  `f0825bf89a28de560de99006802e065e17b9e038`.
- [AltWFC server emulator](https://github.com/barronwaffles/dwc_network_server_emulator), reference
  commit `2c65a9f6afe508e236c222bd1b8f26fd63621a91` (also used to check the enctypeX port).

The WiiCompiled runtime changes remain under that project's GPL licence.
