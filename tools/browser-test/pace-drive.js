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
// Usage (same command file protocol as drive.js):
//   DISPLAY=:0 flock /tmp/mkw-chrome.lock node pace-drive.js "<url>" <outdir>
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const cmdFile = path.join(outdir, 'cmds');
if (!fs.existsSync(cmdFile)) fs.writeFileSync(cmdFile, '');
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'), { flags: 'a' });
const say = (s) => { dlog.write(`${new Date().toISOString()} ${s}\n`); };
const extraArgs = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
const ignoreArgs = ['--disable-gpu', '--mute-audio', ...(process.env.IGNORE_DEFAULT_ARGS || '').split(/\s+/).filter(Boolean)];
const traceCategories = (process.env.TRACE_CATEGORIES ||
  'viz,gpu,cc,blink,benchmark,disabled-by-default-viz.surface_id_flow').split(',');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: false,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebAssemblyExperimentalJSPI', '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900', ...extraArgs],
    ignoreDefaultArgs: ignoreArgs,
  });
  say(`chrome args: ${extraArgs.join(' ') || '(none extra)'}`);
  const page = await browser.newPage({ viewport: process.env.VIEWPORT === 'none' ? null : { width: 1280, height: 860 } });
  const log = fs.createWriteStream(path.join(outdir, 'console.log'));
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);
  log.write(`[0.0] [driver] t0 epoch_ms=${t0}\n`);
  page.on('console', (m) => log.write(`[${stamp()}] [${m.type()}] ${m.text()}\n`));
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
        await browser.startTracing(page, { path: file, categories: traceCategories });
        await page.waitForTimeout(Number(args[0] || 3000));
        await browser.stopTracing();
        say(`trace ${file}`);
      } else if (cmd === 'eval') {
        say('eval -> ' + JSON.stringify(await page.evaluate(args.join(' '))));
      }
      say(`done: ${cmd} ${args.join(' ')}`);
    } catch (e) { say(`error in ${cmd}: ${e}`); }
  }
  await browser.close(); log.end(); say('closed');
})().catch((e) => { say('fatal ' + e); process.exit(1); });
