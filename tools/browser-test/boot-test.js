// Drive the installed Google Chrome (real GPU, X11 display) at the staged WiiCompiled web page,
// collect the console, and screenshot the canvas at intervals. Usage:
//   node boot-test.js <url> <seconds> <outdir>
// With MKW_DISC=/path/to/your/disc.wbfs, the page's disc picker is given that file (read locally
// by the page, never copied) for a site without a staged game folder. MKW_HTTP_USER and
// MKW_HTTP_PASSWORD answer a server's HTTP basic auth challenge (tools/hosting/serve-nginx.sh --user).
// MKW_COLOR_SCHEME=dark|light emulates the system colour scheme.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const [url, secondsArg, outdir] = process.argv.slice(2);
const seconds = Number(secondsArg || 90);
fs.mkdirSync(outdir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: false,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebAssemblyExperimentalJSPI',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,900',
    ],
    ignoreDefaultArgs: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    // MKW_COLOR_SCHEME=dark|light emulates the system theme (the page follows it).
    colorScheme: process.env.MKW_COLOR_SCHEME === 'dark' ? 'dark' : process.env.MKW_COLOR_SCHEME === 'light' ? 'light' : undefined,
    httpCredentials: process.env.MKW_HTTP_USER
      ? { username: process.env.MKW_HTTP_USER, password: process.env.MKW_HTTP_PASSWORD || '' } : undefined,
  });
  const log = fs.createWriteStream(path.join(outdir, 'console.log'));
  page.on('console', (m) => log.write(`[${m.type()}] ${m.text()}\n`));
  page.on('pageerror', (e) => log.write(`[pageerror] ${e.message}\n`));
  page.on('crash', () => log.write('[crash] page crashed\n'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (process.env.MKW_DISC) {
    // A login page (Cloudflare Access) may come first; wait for the real page, up to five minutes.
    await page.waitForSelector('#disc-file', { state: 'attached', timeout: 300000 });
    await page.setInputFiles('#disc-file', process.env.MKW_DISC);
    console.log('picked the disc image');
  }
  const t0 = Date.now();
  let shot = 0;
  const everyMs = 10000;
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(everyMs);
    shot++;
    const name = path.join(outdir, `shot-${String(shot).padStart(2, '0')}.png`);
    await page.screenshot({ path: name });
    const status = await page.evaluate(() => {
      const b = document.getElementById('start');
      const c = document.querySelector('canvas');
      return {
        start: b ? `${b.textContent.trim()} disabled=${b.disabled} hidden=${b.hidden}` : 'n/a',
        canvas: c ? `${c.width}x${c.height}` : 'none',
        body: (document.body.innerText || '').slice(0, 300).replace(/\s+/g, ' '),
      };
    }).catch((e) => ({ error: String(e) }));
    console.log(`t+${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(status)}`);
    // Press Start once it is enabled.
    if (status.start && /disabled=false/.test(status.start) && !/clicked/.test(status.start)) {
      // Start sits on the menu's Play solo screen: open it first (a room page is already on its own screen).
      await page.evaluate(() => { if (document.getElementById('menu')?.dataset.screen === '') document.getElementById('nav-solo')?.click(); }).catch(() => {});
      await page.click('#start').catch(() => {});
      console.log('clicked #start');
    }
  }
  await browser.close();
  log.end();
})().catch((e) => { console.error(e); process.exit(1); });
