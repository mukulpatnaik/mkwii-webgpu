// Two real Chrome clients race together through the room relay (tools/relay): client A creates a
// room, client B joins with the invite code, both press Play online, and both end up in the same
// race. Each client is a fresh Chrome profile (its own OPFS save), on its own X display when two
// are given, so the two can run side by side on nested displays without the GPU lock.
//
//   tools/relay/dev-local.sh --trace &                                   # relay on 127.0.0.1:8787
//   tools/hosting/serve.py work/sites/release-game/public --port 8040 &  # a staged game folder (fetch mode)
//   MKW_DISPLAY_A=$(./nested-display.sh 9) MKW_DISPLAY_B=$(./nested-display.sh 10) \
//     node room-test.js "http://127.0.0.1:8040/WiiCompiled.html?muted" out/relay
//
// What it does, per client: boot the page, create a game profile through the game's own setup
// screens (title, Select Licence, new licence, choose a Mii, confirm; the save lands in this
// profile's OPFS: the direct room entry needs a licence with a Mii), then reload into the room.
// A clicks Create room, B types the code and clicks Join room; both set a name, wait for the lobby
// roster to show two players, and click Play online, which connects the game to the room and
// opens character selection ([room-launch] lines). From there A is pressed (left click) every few
// seconds: character, vehicle, drift, the course vote; the game matches the two players in the
// room and the race starts. The clients then hold accelerate for MKW_RACE_SECONDS (default 30).
//
// Output in <outdir>: driver.log (steps, rosters, verdict), console-a.log and console-b.log (the
// pages' consoles: [vnet], [room-launch], [web-warm], [web-perf] lines), screenshots, and
// healthy.log (the lines that show the relay path worked). Exit code 0 when both clients reached a
// running race, 1 otherwise. Player-to-player packet rates are in the relay's own log
// (dev-local.sh --trace). MKW_LICENCE=0 skips the profile setup when the site's staged game folder
// seeds a save (game/save/rksys.dat).
//
// For the demo video (tools/video/capture.sh multiplayer): MKW_WINDOW_A and MKW_WINDOW_B
// ("WxH+X+Y") put the two clients in X11 windows of that size and place on one display, with no
// viewport emulation and no automation bar, and hide the page's controls panel once the game is
// launched. The driver's marks (`[driver] mark <name>`: page, lobby, play, race-loaded, go, end)
// and its epoch time go into both console logs, so the recording can be cut by them.
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [url, outdir] = process.argv.slice(2);
if (!url || !outdir) {
  console.error('usage: node room-test.js <page-url> <outdir>');
  process.exit(2);
}
fs.mkdirSync(outdir, { recursive: true });
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'), { flags: 'a' });
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const say = (s) => { const line = `[${stamp()}] ${s}`; dlog.write(line + '\n'); console.log(line); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raceSeconds = Number(process.env.MKW_RACE_SECONDS || 30);
const createLicence = process.env.MKW_LICENCE !== '0';
const displays = { a: process.env.MKW_DISPLAY_A || process.env.DISPLAY, b: process.env.MKW_DISPLAY_B || process.env.DISPLAY };
const windows = { a: process.env.MKW_WINDOW_A, b: process.env.MKW_WINDOW_B };
const windowed = !!(windows.a && windows.b);
const chromeArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebAssemblyExperimentalJSPI', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900'];
const windowArgs = (spec) => {
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(spec || '');
  if (!m) return [];
  // --test-type keeps Chrome's "unsupported command-line flag" bar out of the recording.
  return [`--window-size=${m[1]},${m[2]}`, `--window-position=${m[3]},${m[4]}`, '--ozone-platform=x11',
    '--hide-crash-restore-bubble', '--no-default-browser-check', '--test-type'];
};
const consoleLogs = [];
const mark = (name) => { for (const log of consoleLogs) log.write(`[${stamp()}] [driver] mark ${name}\n`); say(`mark ${name}`); };

// The game's menu route from the first screen to the main menu on a fresh save, as timed clicks
// (left click is A): intro, title, Select Licence, new licence, Choose a Mii, confirm, ready, the
// guest note. Same cadence as routes/gp-50cc.cmds.
const licenceRoute = [2500, 3000, 2500, 3000, 2500, 4000, 4000, 4000];

class Client {
  constructor(label, name) {
    this.label = label;
    this.name = name;
    this.lines = [];
    this.watchers = [];
    this.racing = false;
  }

  async launch() {
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `mkw-room-${this.label}-`));
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      executablePath: '/usr/bin/google-chrome', headless: false, args: [...chromeArgs, ...windowArgs(windows[this.label])],
      ignoreDefaultArgs: ['--disable-gpu', '--mute-audio', ...(windowed ? ['--enable-automation'] : [])],
      chromiumSandbox: windowed, // Chrome's own sandbox stays on: no "--no-sandbox" warning bar in the recording
      viewport: windowed ? null : { width: 1280, height: 860 },
      env: { ...process.env, DISPLAY: displays[this.label] },
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    const log = fs.createWriteStream(path.join(outdir, `console-${this.label}.log`), { flags: 'a' });
    log.write(`[${stamp()}] [driver] t0 epoch_ms=${t0}\n`);
    consoleLogs.push(log);
    const record = (kind, text) => {
      const line = `[${stamp()}] [${kind}] ${text}`;
      log.write(line + '\n');
      this.lines.push(text);
      if (/\[room-launch\] (manual|failed):/.test(text)) say(`${this.label}: ${text}`);
      this.watchers = this.watchers.filter((w) => !w(text));
    };
    this.page.on('console', (m) => record(m.type(), m.text()));
    this.page.on('pageerror', (e) => record('pageerror', e.message));
    this.page.on('crash', () => record('crash', 'page crashed'));
    this.page.on('dialog', async (d) => { say(`${this.label}: dialog accepted: ${d.message()}`); await d.accept(); });
    say(`${this.label}: Chrome on DISPLAY=${displays[this.label]}, profile ${this.profileDir}`);
  }

  // Resolves with the first console line matching `pattern` (past or future) within `ms`.
  waitForLine(pattern, ms, what = String(pattern)) {
    const found = this.lines.find((l) => pattern.test(l));
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: no ${what} within ${ms / 1000} s`)), ms);
      this.watchers.push((text) => {
        if (!pattern.test(text)) return false;
        clearTimeout(timer);
        resolve(text);
        return true;
      });
    });
  }

  async shot(name) {
    const file = path.join(outdir, `${this.label}-${name}.png`);
    await this.page.screenshot({ path: file }).catch((e) => say(`${this.label}: screenshot failed: ${e.message}`));
    return file;
  }

  // The page's own A press: left click on the canvas.
  async pressA(holdMs = 120) {
    await this.page.mouse.move(500, 430);
    await this.page.mouse.down();
    await sleep(holdMs);
    await this.page.mouse.up();
  }

  startState() {
    return this.page.evaluate(() => {
      const b = document.getElementById('start');
      return { text: b?.textContent.trim(), disabled: !!b?.disabled, hidden: !!b?.hidden,
        status: document.getElementById('status')?.textContent.trim(),
        room: document.getElementById('room-message')?.textContent.trim() };
    }).catch(() => ({}));
  }

  async waitForStart(expectedText, ms) {
    await this.page.waitForFunction((text) => {
      const b = document.getElementById('start');
      return b && !b.disabled && !b.hidden && (!text || b.textContent.trim() === text);
    }, expectedText, { timeout: ms, polling: 250 });
  }

  roster() {
    return this.page.evaluate(() => ({
      count: document.getElementById('room-count')?.textContent.trim(),
      players: [...document.querySelectorAll('#room-roster li')].map((li) => li.textContent.trim().replace(/\s+/g, ' ')),
      connection: document.getElementById('room-connection')?.textContent.trim(),
      game: document.getElementById('room-game-status')?.textContent.trim(),
    })).catch(() => ({}));
  }

  async open(target) {
    await this.page.goto(target, { waitUntil: 'domcontentloaded' });
    say(`${this.label}: opened ${target}`);
  }

  // Boot once without a room and create a game profile through the game's own setup screens.
  async createLicence() {
    await this.open(url);
    await this.waitForStart('Start', 300000);
    await this.page.click('#start');
    say(`${this.label}: clicked Start; waiting for the first screen`);
    await this.waitForLine(/\[web-perf\] fps=/, 120000, '[web-perf] line after Start');
    await sleep(20000);
    await this.shot('setup-first-screen');
    for (const wait of licenceRoute) { await this.pressA(); await sleep(wait); }
    await this.shot('setup-main-menu');
    const info = await this.page.evaluate(() => window.mkwSaves?.info?.()).catch((e) => ({ error: String(e) }));
    say(`${this.label}: profile setup done; save: ${JSON.stringify(info).slice(0, 300)}`);
    await sleep(3000); // let the NAND write settle before the page is left
  }

  async close() {
    await this.context?.close().catch(() => {});
    if (this.profileDir) fs.rmSync(this.profileDir, { recursive: true, force: true });
  }
}

const a = new Client('a', 'Alice'), b = new Client('b', 'Bob');
let ok = false;
(async () => {
  await a.launch();
  await b.launch();
  if (createLicence) await Promise.all([a.createLicence(), b.createLicence()]);

  // A creates the room; the page moves to ?room=<code>.
  await a.open(url);
  await a.page.waitForSelector('#create-room', { state: 'attached', timeout: 60000 });
  await a.page.click('#create-room');
  await a.page.waitForFunction(() => /[?&]room=[a-z0-9]{6,32}/.test(location.search), null, { timeout: 30000 });
  const code = new URL(a.page.url()).searchParams.get('room');
  say(`a: created room ${code}; invite ${a.page.url()}`);

  // B types the code into Join room.
  await b.open(url);
  await b.page.waitForSelector('#room-code', { state: 'attached', timeout: 60000 });
  await b.page.fill('#room-code', code);
  await b.page.click('#join-room');
  await b.page.waitForFunction((c) => location.search.includes(`room=${c}`), code, { timeout: 30000 });
  say(`b: joined room ${code}`);
  mark('page');

  // Both: lobby connected (Play online enabled), names set, two in the roster, then Play.
  for (const c of [a, b]) {
    await c.waitForStart('Play online', 300000);
    await c.page.fill('#room-name', c.name);
  }
  for (const c of [a, b]) {
    await c.page.waitForFunction(() => document.querySelectorAll('#room-roster li').length === 2, null, { timeout: 30000 });
    say(`${c.label}: lobby ${JSON.stringify(await c.roster())}`);
    await c.shot('lobby');
  }
  mark('lobby');
  if (windowed) await sleep(4000); // the lobby with both names, for the recording
  for (const c of [a, b]) { await c.page.click('#start'); say(`${c.label}: clicked Play online`); }
  mark('play');
  if (windowed) for (const c of [a, b]) await c.page.evaluate(() => document.getElementById('hide-controls')?.click()).catch(() => {});

  // The direct room entry: [vnet] joins the room, the game logs in, character selection opens.
  // A manual or failed hand-off ends the run (the game then needs its own menus).
  const handedOff = (c, ms) => c.waitForLine(/\[room-launch\] (manual|failed):/, ms).then((line) => { throw new Error(`${c.label}: ${line}`); });
  await Promise.all([a, b].map(async (c) => {
    say(`${c.label}: ${await Promise.race([c.waitForLine(/\[vnet\] joined the room as/, 120000, '[vnet] joined line'), handedOff(c, 120000)])}`);
    const result = await Promise.race([
      c.waitForLine(/\[room-launch\] character selection ready/, 180000, '[room-launch] character selection ready'),
      handedOff(c, 180000),
    ]);
    say(`${c.label}: ${result}`);
    say(`${c.label}: roster ${JSON.stringify(await c.roster())}`);
    await c.shot('character-select');
  }));

  // Press A through character, vehicle, drift and the course vote until both are racing. The
  // race has started once [web-warm] lists the players of the race being loaded, or [web-pace]
  // reports race steps.
  const raceLine = /\[web-warm\] \d+ players|\[web-pace\] race steps\/s=/;
  const raceStarted = (c) => c.lines.some((l) => raceLine.test(l));
  const deadline = Date.now() + 240000;
  let presses = 0;
  while (Date.now() < deadline && !(a.racing && b.racing)) {
    for (const c of [a, b]) {
      if (!c.racing && raceStarted(c)) {
        c.racing = true;
        say(`${c.label}: race: ${c.lines.find((l) => raceLine.test(l))}`);
      }
      if (!c.racing) await c.pressA();
    }
    presses++;
    if (presses % 3 === 0) for (const c of [a, b]) if (!c.racing) await c.shot(`menu-${String(presses).padStart(2, '0')}`);
    await sleep(4000);
  }
  if (!(a.racing && b.racing)) throw new Error(`race did not start for ${[a, b].filter((c) => !c.racing).map((c) => c.label).join(' and ')}`);

  // Both in the race: hold accelerate and tap a steering key every two seconds (the game drops
  // a player after 1,800 frames without a new press; a held button alone does not count), then
  // look at the picture and the pacing lines.
  say(`both clients are loading the same race; driving for ${raceSeconds} s`);
  mark('race-loaded');
  await sleep(12000);
  mark('go');
  for (const c of [a, b]) { await c.page.mouse.move(500, 430); await c.page.mouse.down(); }
  const raceEnd = Date.now() + raceSeconds * 1000;
  for (let n = 0; Date.now() < raceEnd; n++) {
    for (const c of [a, b]) {
      await c.page.keyboard.down(n % 2 ? 'a' : 'd');
      await sleep(250);
      await c.page.keyboard.up(n % 2 ? 'a' : 'd');
    }
    if (n === 4) for (const c of [a, b]) await c.shot('race-early');
    await sleep(1500);
  }
  for (const c of [a, b]) {
    await c.shot('race');
    say(`${c.label}: roster ${JSON.stringify(await c.roster())}`);
    const perf = [...c.lines].reverse().find((l) => /\[web-perf\] fps=/.test(l));
    say(`${c.label}: ${perf || 'no [web-perf] line'}`);
    await c.page.mouse.up().catch(() => {});
  }
  const closed = [a, b].filter((c) => c.lines.some((l) => /\[vnet\] room connection closed|\[room-launch\] failed:/.test(l)));
  if (closed.length) throw new Error(`room connection lost during the race on ${closed.map((c) => c.label).join(' and ')}`);
  ok = true;
})().catch(async (e) => {
  say(`FAILED: ${e.message}`);
  for (const c of [a, b]) {
    if (!c.page) continue;
    await c.shot('failed');
    say(`${c.label}: start ${JSON.stringify(await c.startState())}; roster ${JSON.stringify(await c.roster())}`);
  }
}).finally(async () => {
  const healthy = [];
  for (const c of [a, b]) {
    for (const l of c.lines) {
      if (/\[vnet\]|\[room-launch\]|\[web-warm\]|\[web-saves\] game lock|\[web-disc\] opened|mounted \d+ game files/.test(l)) healthy.push(`${c.label}: ${l}`);
    }
    const pace = [...c.lines].reverse().find((l) => /\[web-pace\] race steps/.test(l));
    if (pace) healthy.push(`${c.label}: ${pace}`);
    const perf = [...c.lines].reverse().find((l) => /\[web-perf\] fps=/.test(l));
    if (perf) healthy.push(`${c.label}: ${perf}`);
  }
  fs.writeFileSync(path.join(outdir, 'healthy.log'), healthy.join('\n') + '\n');
  say(ok ? 'PASS: both clients raced through the relay' : 'FAIL');
  mark('end');
  if (windowed) await sleep(2000); // let a recording stop before the windows go
  await a.close();
  await b.close();
  dlog.end();
  process.exit(ok ? 0 : 1);
});
