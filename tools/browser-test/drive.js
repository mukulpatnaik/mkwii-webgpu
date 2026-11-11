// Interactive driver: boots the page like boot-test.js, then polls <outdir>/cmds for new lines.
// Commands: click [x y] | key <Name> [holdMs] | wait <ms> | shot <name> | eval <js> |
//           pick <path to your disc image> (sets the page's disc file input; the file is read
//           locally by the page, never copied) | quit
// Every command line is executed once, in order; output goes to <outdir>/driver.log.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
// The drivers and their routes speak the WASD + mouse layout (a click is the game's A button, a and
// d steer); the page's default is the arrow keys, so ask for the old layout unless the URL says.
const withLayout = (u) => /[?&]layout=/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'layout=wasd';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const cmdFile = path.join(outdir, 'cmds');
if (!fs.existsSync(cmdFile)) fs.writeFileSync(cmdFile, '');
const dlog = fs.createWriteStream(path.join(outdir, 'driver.log'), { flags: 'a' });
const say = (s) => { dlog.write(`${new Date().toISOString()} ${s}\n`); };
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
  await page.goto(withLayout(url), { waitUntil: 'domcontentloaded' });
  say('loaded');
  let done = 0, shotN = 0, startClicked = false;
  for (;;) {
    if (!startClicked) {
      const ok = await page.evaluate(() => { const b = document.getElementById('start'); return b && !b.disabled && !b.hidden; }).catch(() => false);
      if (ok) { await page.evaluate(() => { if (document.getElementById('menu')?.dataset.screen === '') document.getElementById('nav-solo')?.click(); }).catch(() => {}); await page.click('#start').catch(() => {}); startClicked = true; say('clicked #start'); }
    }
    const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter((l) => l.trim());
    if (done >= lines.length) { await page.waitForTimeout(300); continue; }
    const [cmd, ...args] = lines[done++].trim().split(/\s+/);
    try {
      if (cmd === 'quit') break;
      if (cmd === 'wait') await page.waitForTimeout(Number(args[0]));
      else if (cmd === 'pick') {
        await page.setInputFiles('#disc-file', args.join(' '));
      } else if (cmd === 'click') {
        const x = Number(args[0] || 640), y = Number(args[1] || 430);
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(Number(args[2] || 120)); await page.mouse.up();
      } else if (cmd === 'key') {
        await page.keyboard.down(args[0]); await page.waitForTimeout(Number(args[1] || 120)); await page.keyboard.up(args[0]);
      } else if (cmd === 'shot') {
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${args[0] || 'shot'}.png`);
        await page.screenshot({ path: name }); say(`shot ${name}`);
      } else if (cmd === 'eval') {
        say('eval -> ' + JSON.stringify(await page.evaluate(args.join(' '))));
      }
      say(`done: ${cmd} ${args.join(' ')}`);
    } catch (e) { say(`error in ${cmd}: ${e}`); }
  }
  await browser.close(); log.end(); say('closed');
})().catch((e) => { say('fatal ' + e); process.exit(1); });
