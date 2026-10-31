// drive.js plus what the presentation-pacing work (track B) needs:
//   * extra Chrome switches from CHROME_ARGS (space separated), e.g. to uncap the display rate:
//       CHROME_ARGS="--disable-gpu-vsync --disable-frame-rate-limit"
//   * "trace <ms> <name>": records a Chrome performance trace for <ms> into <outdir>/<name>.json
//     (categories from TRACE_CATEGORIES, default below) so canvas frame submissions can be
//     checked against the display's BeginFrames from outside the page.
//   * "goto <url>": loads another URL (other page options) and clicks Start again.
//   * "script <file>": runs the lines of <file> next (a saved menu route, e.g. routes/gp-50cc.cmds).
//   * "mousedown [x y]" / "mouseup", "keydown <Name>" / "keyup <Name>": hold an input across commands
//     (left click is accelerate in a race).
// What the demo-video capture (tools/video/capture.sh) adds:
//   * VIEWPORT=none: no viewport emulation, the page fills the Chrome window (CHROME_ARGS sets
//     --window-size / --window-position); IGNORE_DEFAULT_ARGS="--enable-automation" drops the
//     "controlled by automated test software" bar.
//   * "mark <name>": writes `[driver] mark <name>` into console.log, so a point in the route can be
//     found again by time; the first console.log line records the driver's epoch time, and the
//     Start click is logged there too.
//   * "waitstart [ms]": waits until the page's Start button has been clicked (it is clicked as soon
//     as it is enabled), so the commands after it are timed from the game's start.
//   * "pick <path>": gives the page's disc picker a disc image (read locally by the page).
//   * "waitlog <timeoutSec> <regex>": waits until a console line matches (the regex is the rest of
//     the line); only lines after the previous waitlog's match count, as in parity-drive.js. Menu
//     routes anchor on the game's own lines instead of counting from Start, whose timing varies.
//   * window.__mkwGuest in the page (guest-memory.js): the game's memory for `eval` lines, e.g.
//     `eval window.__mkwGuest.autodrive('ghost')` (the staff ghost's inputs on the player's kart),
//     and window.__mkwBot (kart-bot.js), a driving bot on a fake pad: `eval window.__mkwBot.start()`.
// Usage (same command file protocol as drive.js):
//   DISPLAY=:0 flock /tmp/mkw-chrome.lock node pace-drive.js "<url>" <outdir>
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const portal = require('./portal'); // MKW_CHROME, MKW_PORTAL: another Chromium, e.g. the Portal dev build
const guestMemory = require('./guest-memory');
const kartBot = require('./kart-bot');
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const cmdFile = path.join(outdir, 'cmds');
if (!fs.existsSync(cmdFile)) fs.writeFileSync(cmdFile, '');
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'), { flags: 'a' });
const say = (s) => { dlog.write(`${new Date().toISOString()} ${s}\n`); };
const extraArgs = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
const ignoreArgs = ['--disable-gpu', '--mute-audio', ...(process.env.IGNORE_DEFAULT_ARGS || '').split(/\s+/).filter(Boolean)];
let profile = null;
const removeProfile = () => { if (profile) fs.rmSync(profile, { recursive: true, force: true }); profile = null; };
const traceCategories = (process.env.TRACE_CATEGORIES ||
  'viz,gpu,cc,blink,benchmark,disabled-by-default-viz.surface_id_flow').split(',');
(async () => {
  const launchOptions = {
    executablePath: portal.executable(), headless: false,
    args: ['--enable-unsafe-webgpu', portal.features(), '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900', ...portal.portalArgs(), ...extraArgs],
    ignoreDefaultArgs: ignoreArgs,
    env: portal.launchEnv(),
  };
  const viewport = process.env.VIEWPORT === 'none' ? null : { width: 1280, height: 860 };
  // Portal's chrome lives in its startup window, so Portal runs as a persistent context (a window
  // from the start, a short profile path for its sidecar socket); Chrome gets a page on demand.
  let browser, page;
  if (portal.isPortal()) {
    // A fresh profile per run (a few hundred MB once the game has cached its files), removed on exit.
    profile = fs.mkdtempSync('/tmp/mkw-pd-');
    browser = await chromium.launchPersistentContext(profile, { ...launchOptions, viewport });
    say(`${portal.executable()} args: ${extraArgs.join(' ') || '(none extra)'}; profile ${profile}`);
    await portal.releaseOnboarding(say);
    await portal.themeSpace(browser, process.env.MKW_SPACE_THEME, say);
    page = await portal.visiblePage(browser, say);
  } else {
    browser = await chromium.launch(launchOptions);
    say(`${portal.executable()} args: ${extraArgs.join(' ') || '(none extra)'}`);
    page = await browser.newPage({ viewport });
  }
  await page.addInitScript(guestMemory);
  await page.addInitScript(kartBot);
  const log = fs.createWriteStream(path.join(outdir, 'console.log'));
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);
  log.write(`[0.0] [driver] t0 epoch_ms=${t0}\n`);
  const lines = [], waiters = [];
  let cursor = 0;
  page.on('console', (m) => {
    const text = m.text();
    log.write(`[${stamp()}] [${m.type()}] ${text}\n`);
    lines.push(text);
    const k = waiters.findIndex((w) => w.re.test(text));
    if (k >= 0) { cursor = lines.length; waiters.splice(k, 1)[0].resolve(text); }
  });
  page.on('pageerror', (e) => log.write(`[pageerror] ${e.message}\n`));
  page.on('crash', () => log.write('[crash] page crashed\n'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  say('loaded');
  let done = 0, shotN = 0, startClicked = false;
  const queue = [];
  const clickStartIfEnabled = async () => {
    if (startClicked) return;
    const ok = await page.evaluate(() => { const b = document.getElementById('start'); return b && !b.disabled && !b.hidden; }).catch(() => false);
    if (ok) {
      await page.click('#start').catch(() => {}); startClicked = true;
      say('clicked #start'); log.write(`[${stamp()}] [driver] clicked #start\n`);
    }
  };
  for (;;) {
    await clickStartIfEnabled();
    if (!queue.length) {
      const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
      if (done >= lines.length) { await page.waitForTimeout(300); continue; }
      queue.push(lines[done++]);
    }
    const line = queue.shift();
    const [cmd, ...args] = line.trim().split(/\s+/);
    try {
      if (cmd === 'quit') break;
      if (cmd === 'wait') await page.waitForTimeout(Number(args[0]));
      else if (cmd === 'goto') {
        // A fresh load of another URL (e.g. other page options) in the same browser.
        log.write(`[${stamp()}] [driver] goto ${args[0]}\n`);
        await page.goto(args[0], { waitUntil: 'domcontentloaded' }); startClicked = false;
      }
      else if (cmd === 'mark') log.write(`[${stamp()}] [driver] mark ${args.join(' ')}\n`);
      else if (cmd === 'waitstart') {
        const deadline = Date.now() + Number(args[0] || 60000);
        while (!startClicked && Date.now() < deadline) { await clickStartIfEnabled(); if (!startClicked) await page.waitForTimeout(200); }
        if (!startClicked) say('waitstart: Start was not enabled in time');
      }
      else if (cmd === 'waitlog') {
        const re = new RegExp(args.slice(1).join(' '));
        const k = lines.findIndex((l, j) => j >= cursor && re.test(l));
        let text;
        if (k >= 0) { cursor = k + 1; text = lines[k]; }
        else {
          text = await new Promise((resolve, reject) => {
            const w = { re, resolve };
            waiters.push(w);
            setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout')); } },
                       Number(args[0] || 120) * 1000);
          });
        }
        log.write(`[${stamp()}] [driver] waitlog ${re.source}\n`);
        say(`waitlog ${re.source} -> ${text.slice(0, 160)}`);
      }
      else if (cmd === 'pick') await page.setInputFiles('#disc-file', args.join(' '));
      else if (cmd === 'script') {
        const extra = fs.readFileSync(args[0], 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
        queue.unshift(...extra);
      } else if (cmd === 'click') {
        const x = Number(args[0] || 640), y = Number(args[1] || 430);
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(Number(args[2] || 120)); await page.mouse.up();
      } else if (cmd === 'key') {
        await page.keyboard.down(args[0]); await page.waitForTimeout(Number(args[1] || 120)); await page.keyboard.up(args[0]);
      } else if (cmd === 'mousedown') {
        await page.mouse.move(Number(args[0] || 640), Number(args[1] || 430)); await page.mouse.down();
      } else if (cmd === 'mouseup') {
        await page.mouse.up();
      } else if (cmd === 'keydown') {
        await page.keyboard.down(args[0]);
      } else if (cmd === 'keyup') {
        await page.keyboard.up(args[0]);
      } else if (cmd === 'shot') {
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${args[0] || 'shot'}.png`);
        await page.screenshot({ path: name }); say(`shot ${name}`);
      } else if (cmd === 'trace') {
        const file = path.join(outdir, `${args[1] || 'trace'}.json`);
        const tracer = browser.startTracing ? browser : page.context().browser();
        await tracer.startTracing(page, { path: file, categories: traceCategories });
        await page.waitForTimeout(Number(args[0] || 3000));
        await tracer.stopTracing();
        say(`trace ${file}`);
      } else if (cmd === 'eval') {
        say('eval -> ' + JSON.stringify(await page.evaluate(args.join(' '))));
      }
      say(`done: ${cmd} ${args.join(' ')}`);
    } catch (e) { say(`error in ${cmd}: ${e}`); }
  }
  await browser.close(); log.end(); removeProfile(); say('closed');
})().catch((e) => { say('fatal ' + e); removeProfile(); process.exit(1); });
// capture.sh stops a run that overruns with SIGINT.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { removeProfile(); process.exit(130); });
