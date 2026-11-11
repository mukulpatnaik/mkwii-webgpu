// Gamepad driver: like drive.js (boots the page, clicks #start, polls <outdir>/cmds), but game input
// comes from virtual pads made by virtual-pad.py, so the game is driven with a controller only.
//
//   ./virtual-pad.py --count 1 --socket /tmp/vpad.sock &
//   DISPLAY=$(./nested-display.sh 7) node pad-drive.js "http://127.0.0.1:$PORT/WiiCompiled.html?muted" out/pad /tmp/vpad.sock
//
// Commands (one per line in <outdir>/cmds, each run once, in order; results in <outdir>/driver.log):
//   pad <virtual-pad command>   sent verbatim to virtual-pad.py, e.g. `pad tap 0 a 150`,
//                               `pad axis 0 lx 32767`, `pad btn 0 rt 1`, `pad reset all`
//   gp                          log navigator.getGamepads() (id, mapping, pressed buttons, axes)
//   gpwait [n] [ms]             tap an unbound button (left-stick click) on all pads until the page sees n
//   wait <ms> | shot <name> | eval <js> | key <Name> [holdMs] | quit
//   uiclick <x> <y>             mouse click for the F10 overlay or the page's own UI only: on the game
//                               itself a left click is A on the keyboard port, so never use it to play.
//
// Fake mode: pass `fake:<n>` instead of a socket path to replace navigator.getGamepads() with n
// scripted standard-mapping pads (same `pad` command grammar, values as for virtual-pad.py).
// Use it for several pads: Chrome on Linux groups device nodes into one gamepad by the sysfs path
// before the "input" component, which is /sys/devices/virtual/ for every uinput device, so it
// shows only one of several virtual-pad.py pads. Fake pads skip the OS and Chrome's device layer
// and test only the page, Emscripten's gamepad glue, SDL and the game.
const { chromium } = require('playwright-core');
const fs = require('fs');
const net = require('net');
const path = require('path');
// The drivers and their routes speak the WASD + mouse layout (a click is the game's A button, a and
// d steer); the page's default is the arrow keys, so ask for the old layout unless the URL says.
const withLayout = (u) => /[?&]layout=/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'layout=wasd';
const [url, outdir, padSocket = '/tmp/vpad.sock'] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const cmdFile = path.join(outdir, 'cmds');
if (!fs.existsSync(cmdFile)) fs.writeFileSync(cmdFile, '');
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'), { flags: 'a' });
const say = (s) => { dlog.write(`${new Date().toISOString()} ${s}\n`); };

// One persistent connection to virtual-pad.py; each command waits for its reply line.
let padConn = null, padBuf = '', padWaiters = [];
let fakePage = null;
async function padSend(line) {
  if (fakePage) {
    const [cmd, which, name, hold] = line.split(/\s+/);
    if (cmd !== 'tap') return fakePage.evaluate((l) => window.__fakePad(l), line);
    await fakePage.evaluate((l) => window.__fakePad(l), `btn ${which} ${name} 1`);
    await fakePage.waitForTimeout(Number(hold || 120));
    return fakePage.evaluate((l) => window.__fakePad(l), `btn ${which} ${name} 0`);
  }
  if (!padConn) {
    padConn = net.createConnection(padSocket);
    padConn.setEncoding('utf8');
    padConn.on('data', (d) => {
      padBuf += d;
      let i;
      while ((i = padBuf.indexOf('\n')) >= 0) {
        const reply = padBuf.slice(0, i); padBuf = padBuf.slice(i + 1);
        const w = padWaiters.shift(); if (w) w(reply);
      }
    });
    // virtual-pad.py may be restarted (hot-plug tests): drop the connection and reconnect next time.
    const conn = padConn;
    const drop = (why) => { if (padConn === conn) padConn = null; for (const w of padWaiters.splice(0)) w('err ' + why); };
    padConn.on('error', (e) => { say('pad socket error ' + e); drop(e); });
    padConn.on('close', () => drop('pad socket closed'));
  }
  return new Promise((resolve) => { padWaiters.push(resolve); padConn.write(line + '\n'); });
}

const fakeCount = padSocket.startsWith('fake:') ? Number(padSocket.slice(5)) : 0;
// Runs in the page. Standard-mapping indices: buttons a0 b1 x2 y3 lb4 rb5 lt6 rt7 back8 start9 ls10
// rs11 up12 down13 left14 right15 guide16; axes lx0 ly1 rx2 ry3.
// FAKE_PROFILE=powera imitates what Chrome on Linux reports for a PowerA Core (Plus) Wired
// Controller (20d6:a711): no standard layout, 14 buttons in HID order, the D-pad hat as axes 4/5.
// Its button names are the pad's printed Switch labels (b is the bottom button); its D-pad is
// `pad axis 0 hatx|haty -32767|32767`.
function installFakePads([count, profile]) {
  // FAKE_PROFILE=unknown: the same layout under a vendor/product SDL has no mapping for.
  const powera = profile === 'powera' || profile === 'unknown';
  const BTN = powera
    ? { y: 0, b: 1, a: 2, x: 3, l: 4, r: 5, zl: 6, zr: 7, minus: 8, plus: 9, ls: 10, rs: 11, home: 12, capture: 13 }
    : { a: 0, south: 0, b: 1, east: 1, x: 2, west: 2, y: 3, north: 3, lb: 4, rb: 5, back: 8, select: 8,
        start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, guide: 16, mode: 16 };
  const AX = powera ? { lx: 0, ly: 1, rx: 2, ry: 3, hatx: 4, haty: 5 } : { lx: 0, ly: 1, rx: 2, ry: 3 };
  const pads = Array.from({ length: count }, (_, i) => ({
    id: profile === 'unknown' ? 'Test Unknown Pad (Vendor: 1234 Product: 5678)'
      : powera ? 'PowerA Core (Plus) Wired Controller (Vendor: 20d6 Product: a711)'
               : `Fake standard pad ${i + 1} (STANDARD GAMEPAD Vendor: 045e Product: 028e)`,
    index: i, connected: true, mapping: powera ? '' : 'standard', timestamp: performance.now(),
    axes: powera ? [0, 0, 0, 0, 0, 0] : [0, 0, 0, 0], vibrationActuator: null,
    buttons: Array.from({ length: powera ? 14 : 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  }));
  Navigator.prototype.getGamepads = function () { return pads.map((p) => ({ ...p, axes: [...p.axes], buttons: p.buttons.map((b) => ({ ...b })) })); };
  const setButton = (p, n, v) => { p.buttons[n] = { pressed: v > 0.5, touched: v > 0, value: v }; };
  window.__fakePad = (line) => {
    const [cmd, which, name, raw] = line.split(/\s+/);
    if (cmd === 'connect') {
      for (const p of pads) { const e = new Event('gamepadconnected'); e.gamepad = p; window.dispatchEvent(e); }
      return 'ok';
    }
    const targets = which === 'all' ? pads : [pads[Number(which)]];
    if (targets.some((p) => !p)) return 'err no pad ' + which;
    for (const p of targets) {
      if (cmd === 'reset') { p.axes.fill(0); p.buttons.forEach((_, n) => setButton(p, n, 0)); }
      else if (cmd === 'btn' && name in BTN) setButton(p, BTN[name], Number(raw) ? 1 : 0);
      else if (cmd === 'axis' && name in AX) p.axes[AX[name]] = Math.max(-1, Math.min(1, Number(raw) / 32767));
      else if (cmd === 'axis' && (name === 'lt' || name === 'rt')) setButton(p, name === 'lt' ? 6 : 7, Math.max(0, Math.min(1, Number(raw) / 255)));
      else if (cmd === 'axis' && name === 'hatx') { setButton(p, 14, Number(raw) < 0 ? 1 : 0); setButton(p, 15, Number(raw) > 0 ? 1 : 0); }
      else if (cmd === 'axis' && name === 'haty') { setButton(p, 12, Number(raw) < 0 ? 1 : 0); setButton(p, 13, Number(raw) > 0 ? 1 : 0); }
      else return 'err bad command ' + line;
      p.timestamp = performance.now();
    }
    return 'ok';
  };
}

const gamepadSummary = () => Array.from(navigator.getGamepads()).map((g, i) => g && {
  index: g.index, slot: i, id: g.id, mapping: g.mapping, connected: g.connected,
  pressed: g.buttons.map((b, n) => (b.pressed || b.value > 0.05) ? `${n}:${b.value.toFixed(2)}` : null).filter(Boolean),
  axes: g.axes.map((a) => +a.toFixed(2)),
});

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: false,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebAssemblyExperimentalJSPI', '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900'],
    ignoreDefaultArgs: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const log = fs.createWriteStream(path.join(outdir, 'console.log'));
  const t0 = Date.now();
  page.on('console', (m) => log.write(`[${((Date.now() - t0) / 1000).toFixed(1)}] [${m.type()}] ${m.text()}\n`));
  page.on('pageerror', (e) => log.write(`[pageerror] ${e.message}\n`));
  page.on('crash', () => log.write('[crash] page crashed\n'));
  // Log the page's own gamepad events, so connection order is visible next to the game's output.
  await page.addInitScript(() => {
    for (const type of ['gamepadconnected', 'gamepaddisconnected']) {
      window.addEventListener(type, (e) => console.log(`[pad-drive] ${type} index=${e.gamepad.index} mapping=${e.gamepad.mapping} id=${e.gamepad.id}`));
    }
  });
  if (fakeCount) { await page.addInitScript(installFakePads, [fakeCount, process.env.FAKE_PROFILE || '']); fakePage = page; say(`fake pads: ${fakeCount}`); }
  await page.goto(withLayout(url), { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  say('loaded');
  let done = 0, shotN = 0, startClicked = false;
  for (;;) {
    if (!startClicked) {
      const ok = await page.evaluate(() => { const b = document.getElementById('start'); return b && !b.disabled && !b.hidden; }).catch(() => false);
      if (ok) { await page.evaluate(() => { if (document.getElementById('menu')?.dataset.screen === '') document.getElementById('nav-solo')?.click(); }).catch(() => {}); await page.click('#start').catch(() => {}); startClicked = true; say('clicked #start'); }
    }
    const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    if (done >= lines.length) { await page.waitForTimeout(300); continue; }
    const line = lines[done++].trim();
    const [cmd, ...args] = line.split(/\s+/);
    try {
      if (cmd === 'quit') break;
      if (cmd === 'wait') await page.waitForTimeout(Number(args[0]));
      else if (cmd === 'pad') say(`pad ${args.join(' ')} -> ${await padSend(args.join(' '))}`);
      else if (cmd === 'gp') say('gamepads -> ' + JSON.stringify(await page.evaluate(gamepadSummary)));
      else if (cmd === 'gpwait') {
        // Chrome only exposes a pad to a page after a button press seen while the page is polling.
        // Tap the left-stick click (unbound in the game) on every pad until <n> pads are visible.
        const want = Number(args[0] || 1), until = Date.now() + Number(args[1] || 30000);
        let seen = 0;
        while (Date.now() < until) {
          await padSend('tap all ls 60');
          seen = await page.evaluate(() => Array.from(navigator.getGamepads()).filter(Boolean).length);
          if (seen >= want) break;
          await page.waitForTimeout(500);
        }
        say(`gpwait: ${seen} pad(s) visible ` + JSON.stringify(await page.evaluate(gamepadSummary)));
      }
      else if (cmd === 'uiclick') {
        // ImGui needs a frame with the pointer over the item before the press, and one with it held.
        await page.mouse.move(Number(args[0]), Number(args[1])); await page.waitForTimeout(150);
        await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
      } else if (cmd === 'key') {
        await page.keyboard.down(args[0]); await page.waitForTimeout(Number(args[1] || 120)); await page.keyboard.up(args[0]);
      } else if (cmd === 'shot') {
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${args[0] || 'shot'}.png`);
        await page.screenshot({ path: name }); say(`shot ${name}`);
      } else if (cmd === 'eval') {
        say('eval -> ' + JSON.stringify(await page.evaluate(args.join(' '))));
      } else { say(`unknown command: ${line}`); continue; }
      say(`done: ${line}`);
    } catch (e) { say(`error in ${line}: ${e}`); }
  }
  if (padConn) padConn.end();
  await browser.close(); log.end(); say('closed');
})().catch((e) => { say('fatal ' + e); process.exit(1); });
