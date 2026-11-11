// Scripted driver for the parity check: boots the page like boot-test.js / drive.js, clicks Start,
// then runs a step file top to bottom (no interactive polling). Usage:
//   node parity-drive.js <url> <steps-file> <outdir> [maxSeconds]
// Steps, one per line ('#' comments):
//   waitlog <timeoutSec> <regex>   wait until a console line matches (the regex is the rest of
//                                  the line, spaces included)
//   wait <ms>                      sleep
//   a [holdMs]                     press A (left click in the middle of the canvas)
//   key <Name> [holdMs]            press a key (Playwright key name: ArrowDown, Enter, Space, ...)
//   shot <name>                    screenshot of the page -> <outdir>/<name>.png
//   burst <name> <seconds>         page frames via the DevTools screencast for <seconds>
//                                  -> <outdir>/<name>/<ms since burst start>.jpg
//   quit
// Writes <outdir>/console.log (timestamped) and <outdir>/driver.log. The output is game-derived:
// keep it under the gitignored out/ directory. Hold /tmp/mkw-chrome.lock while running.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
// The drivers and their routes speak the WASD + mouse layout (a click is the game's A button, a and
// d steer); the page's default is the arrow keys, so ask for the old layout unless the URL says.
const withLayout = (u) => /[?&]layout=/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'layout=wasd';

const [url, stepsFile, outdir, maxArg] = process.argv.slice(2);
if (!url || !stepsFile || !outdir) {
  console.error('usage: node parity-drive.js <url> <steps-file> <outdir> [maxSeconds]');
  process.exit(2);
}
const maxSeconds = Number(maxArg || 600);
fs.mkdirSync(outdir, { recursive: true });
const steps = fs.readFileSync(stepsFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);
const say = (s) => { dlog.write(`[${stamp()}] ${s}\n`); console.log(`[${stamp()}] ${s}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: false,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebAssemblyExperimentalJSPI', '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900'],
    ignoreDefaultArgs: ['--disable-gpu', '--mute-audio'],
  });
  setTimeout(() => { say(`max time ${maxSeconds}s reached`); browser.close().finally(() => process.exit(3)); }, maxSeconds * 1000);
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const log = fs.createWriteStream(path.join(outdir, 'console.log'));
  const lines = [];
  let cursor = 0;
  const waiters = [];
  const onLine = (text) => {
    lines.push(text);
    log.write(`[${stamp()}] ${text}\n`);
    for (const w of waiters.slice()) if (w.re.test(text)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(text); }
  };
  page.on('console', (m) => onLine(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => onLine(`[pageerror] ${e.message}`));
  page.on('crash', () => onLine('[crash] page crashed'));
  await page.goto(withLayout(url), { waitUntil: 'domcontentloaded' });
  say('loaded ' + url);
  for (let i = 0; i < 600; i++) {
    const ok = await page.evaluate(() => { const b = document.getElementById('start'); return b && !b.disabled && !b.hidden; }).catch(() => false);
    if (ok) { await page.evaluate(() => { if (document.getElementById('menu')?.dataset.screen === '') document.getElementById('nav-solo')?.click(); }).catch(() => {}); await page.click('#start').catch(() => {}); say('clicked #start'); break; }
    await page.waitForTimeout(250);
  }
  const canvasBox = async () => (await page.$('canvas')) ? (await (await page.$('canvas')).boundingBox()) : null;

  for (const step of steps) {
    const [cmd, ...args] = step.split(/\s+/);
    try {
      if (cmd === 'quit') break;
      else if (cmd === 'wait') await page.waitForTimeout(Number(args[0]));
      else if (cmd === 'waitlog') {
        // Only lines after the previous waitlog's match count, so repeated waits see new lines.
        const re = new RegExp(args.slice(1).join(' '));
        const k = lines.findIndex((l, j) => j >= cursor && re.test(l));
        const hit = k >= 0 ? lines[k] : null;
        if (hit) cursor = k + 1;
        const text = hit || await new Promise((resolve, reject) => {
          const w = { re, resolve };
          waiters.push(w);
          setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout')); } },
                     Number(args[0] || 120) * 1000);
        });
        if (!hit) cursor = lines.length;
        say(`waitlog ${re.source} -> ${text.slice(0, 160)}`);
        continue;
      } else if (cmd === 'a') {
        const b = await canvasBox();
        const x = b ? b.x + b.width / 2 : 640, y = b ? b.y + b.height / 2 : 430;
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(Number(args[0] || 120)); await page.mouse.up();
      } else if (cmd === 'key') {
        await page.keyboard.down(args[0]); await page.waitForTimeout(Number(args[1] || 120)); await page.keyboard.up(args[0]);
      } else if (cmd === 'shot') {
        await page.screenshot({ path: path.join(outdir, `${args[0] || 'shot'}.png`) });
      } else if (cmd === 'burst') {
        // Chrome's screencast pushes a frame for every composited frame (up to the display rate),
        // which is several times faster than back-to-back screenshots.
        const dir = path.join(outdir, args[0] || 'burst');
        fs.mkdirSync(dir, { recursive: true });
        const cdp = await page.context().newCDPSession(page);
        const start = Date.now();
        let n = 0;
        cdp.on('Page.screencastFrame', (f) => {
          const ms = String(Date.now() - start).padStart(6, '0');
          fs.writeFileSync(path.join(dir, `${ms}.jpg`), Buffer.from(f.data, 'base64'));
          n++;
          cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        });
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
        await page.waitForTimeout(Number(args[1] || 5) * 1000);
        await cdp.send('Page.stopScreencast').catch(() => {});
        await cdp.detach().catch(() => {});
        say(`burst ${args[0]}: ${n} frames in ${args[1]} s`);
        continue;
      } else { say(`unknown step: ${step}`); continue; }
      say(`done: ${step}`);
    } catch (e) { say(`error in "${step}": ${e.message}`); }
  }
  say('steps finished');
  await browser.close(); log.end();
  process.exit(0);
})().catch((e) => { say('fatal ' + e); process.exit(1); });
