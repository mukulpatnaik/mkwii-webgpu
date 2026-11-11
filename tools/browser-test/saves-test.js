// Saves UI test driver (mkw_saves.js): like drive.js, but each "profile" is a fresh Chrome profile
// (launchPersistentContext with its own temporary user-data-dir, so its own OPFS and Web Locks),
// and it can export, import and open a second tab.
//
//   DISPLAY=$(./nested-display.sh 6) node saves-test.js "http://127.0.0.1:$PORT/WiiCompiled.html?muted" out/saves
//   then append commands to out/saves/cmds (or start with a ready-made file: cp routes/saves.cmds out/saves/cmds)
//
// Commands (one per line, run once each, in order; '#' starts a comment):
//   profile <name>        close the current browser and open a fresh profile at the page URL
//   reload | waitready [ms] | start          reload; wait for Start to be enabled; click Start
//   click [x y] | key <Name> [holdMs] | wait <ms> | shot <name> | eval <js>
//   panel <name>          screenshot just the saves panel (scrolled into view)
//   press <selector> [ms] click a page element (e.g. #saves-restore), wait, log the panel
//   info                  log window.mkwSaves.info() (game, NAND path, size, sha256, lock, backups)
//   text                  log the saves panel, the overlay status line and the Start button
//   export save|backup <file>   click Export save / Export backup, keep the download as <outdir>/<file>
//   import <file>         choose <file> (relative to <outdir>) in the panel's file input; dialogs are accepted
//   garbage <file> <bytes> | truncate <src> <dst> <bytes>   write test files into <outdir>
//   tab2 <name>           open a second tab of the same profile, log what it says, screenshot, close it
//   sha <file>            log the sha256 of <outdir>/<file>
//   quit
// Everything goes to <outdir>/driver.log; page consoles to <outdir>/console-<profile>.log.
const { chromium } = require('playwright-core');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
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
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);

let context = null, page = null, profileName = '', profileDir = '', shotN = 0;
const watch = (p, label) => {
  const log = fs.createWriteStream(path.join(outdir, `console-${label}.log`), { flags: 'a' });
  p.on('console', (m) => log.write(`[${stamp()}] [${m.type()}] ${m.text()}\n`));
  p.on('pageerror', (e) => log.write(`[${stamp()}] [pageerror] ${e.message}\n`));
  p.on('crash', () => log.write(`[${stamp()}] [crash] page crashed\n`));
  p.on('dialog', async (d) => { say(`[${label}] dialog accepted: ${d.message()}`); await d.accept(); });
};
const closeProfile = async () => {
  if (!context) return;
  await context.close().catch(() => {});
  fs.rmSync(profileDir, { recursive: true, force: true });
  context = null;
};
// Before Start the saves block is on the menu's Saves screen (the round Saves button opens it);
// after Start it is the Saves card of the corner pill. A page from before the menu shows it
// straight away.
const openSavesView = async (p) => {
  if (await p.locator('#saves-panel').isVisible().catch(() => false)) return;
  const nav = p.locator('#nav-saves');
  if ((await nav.count()) && (await nav.isVisible())) { await nav.click(); return; }
  await p.evaluate(() => document.getElementById('dock-saves')?.click()).catch(() => {});
};
const panelText = (p) => p.evaluate(() => ({
  storage: document.getElementById('saves-storage')?.textContent,
  message: document.getElementById('saves-message')?.textContent,
  status: document.getElementById('status')?.textContent,
  start: { text: document.getElementById('start')?.textContent, disabled: document.getElementById('start')?.disabled,
           hidden: document.getElementById('start')?.hidden },
  buttons: [...document.querySelectorAll('#saves-panel button')].map((b) => `${b.textContent}${b.disabled ? ' (disabled)' : ''}`),
}));
const waitReady = (p, ms = 180000) => p.waitForFunction(() => {
  const b = document.getElementById('start');
  return b && !b.disabled && !b.hidden;
}, null, { timeout: ms, polling: 250 });

(async () => {
  let done = 0;
  for (;;) {
    const lines = fs.readFileSync(cmdFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (done >= lines.length) { await new Promise((r) => setTimeout(r, 300)); continue; }
    const line = lines[done++];
    const [cmd, ...args] = line.split(/\s+/);
    say(`> ${line}`);
    try {
      if (cmd === 'quit') break;
      else if (cmd === 'profile') {
        await closeProfile();
        profileName = args[0] || 'p';
        profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `mkw-saves-${profileName}-`));
        context = await chromium.launchPersistentContext(profileDir, {
          executablePath: '/usr/bin/google-chrome', headless: false, acceptDownloads: true,
          viewport: { width: 1280, height: 860 },
          args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebAssemblyExperimentalJSPI', '--ignore-gpu-blocklist',
                 '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900'],
          ignoreDefaultArgs: ['--disable-gpu', '--mute-audio'],
        });
        page = context.pages()[0] || await context.newPage();
        watch(page, profileName);
        await page.goto(withLayout(url), { waitUntil: 'domcontentloaded' });
        say(`profile ${profileName} at ${profileDir}`);
      } else if (cmd === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
      else if (cmd === 'waitready') { await waitReady(page, Number(args[0] || 180000)); say('ready'); }
      else if (cmd === 'start') { await page.evaluate(() => { if (document.getElementById('menu')?.dataset.screen === '') document.getElementById('nav-solo')?.click(); }).catch(() => {}); await page.click('#start'); }
      else if (cmd === 'wait') await page.waitForTimeout(Number(args[0]));
      else if (cmd === 'click') {
        const x = Number(args[0] || 500), y = Number(args[1] || 430);
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
      } else if (cmd === 'key') {
        await page.keyboard.down(args[0]); await page.waitForTimeout(Number(args[1] || 120)); await page.keyboard.up(args[0]);
      } else if (cmd === 'shot') {
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${profileName}-${args[0] || 'shot'}.png`);
        await page.screenshot({ path: name });
        say(`shot ${name}`);
      } else if (cmd === 'panel') {
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${profileName}-${args[0] || 'panel'}.png`);
        await openSavesView(page);
        await page.locator('#saves-panel').scrollIntoViewIfNeeded();
        await page.locator('#saves-panel').screenshot({ path: name });
        say(`shot ${name}`);
      } else if (cmd === 'press') {
        if (args[0].startsWith('#saves-')) await openSavesView(page);
        await page.click(args[0]);
        await page.waitForTimeout(Number(args[1] || 3000));
        say('text -> ' + JSON.stringify(await panelText(page)));
      } else if (cmd === 'eval') say('eval -> ' + JSON.stringify(await page.evaluate(args.join(' '))));
      else if (cmd === 'info') say('info -> ' + JSON.stringify(await page.evaluate(() => window.mkwSaves.info())));
      else if (cmd === 'text') say('text -> ' + JSON.stringify(await panelText(page)));
      else if (cmd === 'export') {
        const target = path.join(outdir, args[1]);
        const download = page.waitForEvent('download', { timeout: 15000 });
        await openSavesView(page);
        await page.click(args[0] === 'backup' ? '#saves-backup' : '#saves-export');
        const file = await download.catch(() => null);
        if (file) {
          await file.saveAs(target);
          say(`downloaded ${file.suggestedFilename()} -> ${target} (${fs.statSync(target).size} bytes, sha256 ${sha(target)})`);
        } else say('no download');
        await page.waitForTimeout(500);
        say('text -> ' + JSON.stringify(await panelText(page)));
      } else if (cmd === 'import') {
        await page.setInputFiles('#saves-file', path.join(outdir, args[0]));
        await page.waitForTimeout(Number(args[1] || 3000));
        say('text -> ' + JSON.stringify(await panelText(page).catch((e) => String(e))));
      } else if (cmd === 'garbage') {
        fs.writeFileSync(path.join(outdir, args[0]), crypto.randomBytes(Number(args[1] || 1000)));
      } else if (cmd === 'truncate') {
        fs.writeFileSync(path.join(outdir, args[1]), fs.readFileSync(path.join(outdir, args[0])).subarray(0, Number(args[2])));
      } else if (cmd === 'sha') say(`sha256 ${args[0]} ${sha(path.join(outdir, args[0]))}`);
      else if (cmd === 'tab2') {
        const second = await context.newPage();
        watch(second, `${profileName}-tab2`);
        await second.goto(withLayout(url), { waitUntil: 'domcontentloaded' });
        await second.waitForTimeout(Number(args[1] || 20000));
        say('tab2 text -> ' + JSON.stringify(await panelText(second)));
        const name = path.join(outdir, `${String(++shotN).padStart(3, '0')}-${profileName}-${args[0] || 'tab2'}.png`);
        await second.screenshot({ path: name });
        say(`shot ${name}`);
        const panelName = name.replace(/\.png$/, '-panel.png');
        await openSavesView(second);
        await second.locator('#saves-panel').scrollIntoViewIfNeeded();
        await second.locator('#saves-panel').screenshot({ path: panelName });
        say(`shot ${panelName}`);
        await second.close();
      } else say(`unknown command ${cmd}`);
      say(`done: ${line}`);
    } catch (e) { say(`error in ${line}: ${e}`); }
  }
  await closeProfile();
  say('closed');
  dlog.end();
})().catch((e) => { say('fatal ' + e); process.exit(1); });
