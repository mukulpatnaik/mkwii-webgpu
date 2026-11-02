// Driving Portal (~/code/browser: a Chromium build with its own chrome) instead of Google Chrome.
// The dev build takes the usual Chromium switches and a debugging port; the packaged build drops
// the port, so only the dev build can be scripted. A fresh Portal profile boots in its onboarding
// lockdown (no new tab or page before sign-in), which the probe bridge on the root chrome page
// releases the way Portal's own smoke test does: completeOnboarding(), then the gate's release.
//
// Environment (tools/video/capture.sh sets these for MKW_BROWSER=portal):
//   MKW_CHROME       the browser executable (default Google Chrome: /usr/bin/google-chrome, or the
//                    app bundle's binary on macOS)
//   MKW_PORTAL=1     the executable is Portal: open a debugging port and release onboarding
//   CHROME_ARGS      extra switches (space separated), e.g. Portal's --portal-chrome* switches
const executable = () => process.env.MKW_CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
// --enable-features for the game: WebGPU on Linux needs Vulkan; macOS has Metal and no Vulkan.
const features = () => `--enable-features=${process.platform === 'linux' ? 'Vulkan,' : ''}WebAssemblyExperimentalJSPI`;
const isPortal = () => process.env.MKW_PORTAL === '1';
const port = () => 9340 + (Number(process.env.MKW_PORTAL_PORT_OFFSET) || 0); // read per launch
const portalArgs = () => (isPortal() ? [`--remote-debugging-port=${port()}`] : []);

// Chromium takes its X11 window class from CHROME_DESKTOP when a launcher set it; a fixed class
// lets a recorder find the window (xdotool search --class mkw-capture). (On macOS the recorder
// finds the windows by the browser process on the driver's profile instead.)
const launchEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.CHROME_DESKTOP;
  return env;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs `expression` on the root chrome page (chrome://portal/), or another of Portal's chrome
// surfaces, over the debugging port.
async function evalOnRoot(expression, url = 'chrome://portal/', debugPort = port()) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const root = targets.find((t) => t.url === url);
  if (!root) throw new Error(`no ${url} target (is this a Portal build with --portal-chrome?)`);
  const ws = new WebSocket(root.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP socket failed')); });
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id === 1) resolve(msg.result); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    setTimeout(() => reject(new Error('CDP evaluate timed out')), 10000);
  });
  ws.close();
  if (result.exceptionDetails) throw new Error(`root chrome: ${result.exceptionDetails.text}`);
  return result.result?.value;
}

// Waits for the root chrome, completes onboarding and waits for the gate to release.
async function releaseOnboarding(say = () => {}) {
  if (!isPortal()) return;
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      if (await evalOnRoot("window.__portalReady === true && typeof window.__spikeBridge === 'object'")) break;
    } catch (e) { if (Date.now() > deadline) throw e; }
    if (Date.now() > deadline) throw new Error('Portal root chrome did not become ready');
    await sleep(500);
  }
  const done = await evalOnRoot("window.__onboardingGate?.events?.some((e) => e.includes('release')) === true");
  if (!done) {
    await evalOnRoot('window.__spikeBridge.completeOnboarding()');
    const until = Date.now() + 20000;
    while (!(await evalOnRoot("window.__onboardingGate.events.some((e) => e.includes('release'))"))) {
      if (Date.now() > until) throw new Error('Portal onboarding did not release');
      await sleep(300);
    }
  }
  say('portal: onboarding released');
  declineDefaultBrowserPrompt(say);
  await sleep(1000);
}

// A fresh profile can get Portal's "Make Portal your default browser?" toast right after
// onboarding, and it stays up for a minute. Portal creates the toast overlay page with its first
// toast, so this waits in the background (for up to two minutes) for that page and answers the
// prompt "Don't ask again" there with the button's own click, so the root records it like a
// person's; a mutation observer on the page answers any later one before it is drawn.
function declineDefaultBrowserPrompt(say = () => {}) {
  const overlay = 'chrome://portal/overlay.html?slot=toast';
  const install = `(() => {
    if (window.__mkwDeclineDefault) return 'already';
    const decline = () => {
      for (const b of document.querySelectorAll('button')) if (/^Don.t ask again$/.test(b.textContent.trim())) b.click();
    };
    window.__mkwDeclineDefault = new MutationObserver(decline);
    window.__mkwDeclineDefault.observe(document.documentElement, { childList: true, subtree: true });
    decline();
    return 'installed';
  })()`;
  const deadline = Date.now() + 120000, debugPort = port(); // room-test.js moves the port for the next client
  const poll = async () => {
    const done = await evalOnRoot(install, overlay, debugPort).catch(() => null);
    if (done) say(`portal: default-browser prompt answered on the toast overlay (${done})`);
    else if (Date.now() < deadline) setTimeout(poll, 250).unref();
  };
  void poll();
}

// Portal keeps the window's tabs itself: the context's first page (about:blank) is detached and
// has no size, while the tab Portal opened after onboarding is the visible one. Returns the first
// page with a laid-out viewport, waiting for Portal to open its tab.
async function visiblePage(context, say = () => {}) {
  const deadline = Date.now() + 15000;
  for (;;) {
    for (const page of context.pages()) {
      if (page.url().startsWith('chrome://') || page.url().startsWith('devtools://')) continue;
      const width = await page.evaluate(() => (document.visibilityState === 'visible' ? window.innerWidth : 0)).catch(() => 0);
      if (width > 0) { say(`portal: driving the visible tab ${page.url()} (${width} px wide)`); return page; }
    }
    if (Date.now() > deadline) throw new Error(`no visible page in Portal; pages: ${context.pages().map((p) => p.url()).join(', ')}`);
    await sleep(300);
  }
}

// Opens `urls` as tabs ahead of the one the driver uses, which stays in front. The probe bridge
// places a new tab after the active one or at the end and cannot move a tab, so the tabs are
// opened at the end, then a fresh tab after them for the driver, and the first tab is closed.
// Returns the page to drive. MKW_EXTRA_TABS (space separated) for pace-drive.js; Portal only.
async function openBackgroundTabs(context, page, urls, say = () => {}) {
  if (!isPortal() || !urls.length) return page;
  const first = await evalOnRoot('window.__spikeBridge.getTabs().find((t) => t.active)?.id');
  for (const url of [...urls, 'about:blank']) {
    await evalOnRoot(`window.__spikeBridge.createTab(${JSON.stringify(url)}, undefined, 'end')`);
    await sleep(700);
  }
  await evalOnRoot(`window.__spikeBridge.closeTab(${first})`);
  const deadline = Date.now() + 10000;
  while (!page.isClosed()) {
    if (Date.now() > deadline) throw new Error('the first tab did not close');
    await sleep(200);
  }
  // The new tab is the visible about:blank page (the context's own first page is an about:blank
  // with no size; a tab just put behind can still report itself visible for a moment).
  let driven = null;
  while (!driven) {
    for (const p of context.pages()) {
      if (p.url() !== 'about:blank') continue;
      const width = await p.evaluate(() => (document.visibilityState === 'visible' ? window.innerWidth : 0)).catch(() => 0);
      if (width > 0) driven = p;
    }
    if (Date.now() > deadline) throw new Error('no visible new tab to drive');
    if (!driven) await sleep(200);
  }
  const strip = await evalOnRoot('window.__spikeBridge.getTabs().map((t) => t.url).join(" ")');
  say(`portal: opened ${urls.length} tab(s) ahead of the driven one; strip: ${strip}`);
  return driven;
}

// Themes the profile's default space the way Portal's hero-shot script does (~/code/browser
// scripts/hero-shots/hero.ts): the Spaces settings page, "Edit Default", the primary colour as
// hex, then the Strength and Grain sliders (0..100) by keyboard. `spec` is "#rrggbb[,strength[,grain]]"
// (MKW_SPACE_THEME, or MKW_SPACE_THEME_A / _B for the two room clients).
async function themeSpace(context, spec, say = () => {}) {
  if (!isPortal() || !spec) return;
  const [hex, strengthText, grainText] = spec.split(',');
  const strength = Number(strengthText ?? 70), grain = Number(grainText ?? 30);
  const page = await context.newPage();
  try {
    await page.goto('portal://settings?section=spaces', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[aria-label="Edit Default"]', { timeout: 20000 });
    await page.click('button[aria-label="Edit Default"]');
    await sleep(500);
    await page.evaluate((value) => {
      const i = document.querySelector('input[aria-label="Primary colour as hex"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      i.focus(); set.call(i, value); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur();
    }, hex);
    await sleep(300);
    const slider = async (label, value) => {
      const key = (k) => page.evaluate(([label, k]) => {
        const root = document.querySelector(`[aria-label="${label}"]`); if (!root) return null;
        const t = root.matches('[role=slider]') ? root : root.querySelector('[role=slider]'); if (!t) return null;
        t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        return t.getAttribute('aria-valuenow');
      }, [label, k]);
      let now = await key('Home');
      for (let i = 0; i < Math.floor(value / 10); i++) { await sleep(60); now = await key('PageUp'); }
      for (let i = 0; i < value % 10; i++) { await sleep(60); now = await key('ArrowRight'); }
      return now;
    };
    const s = await slider('Strength', strength), g = await slider('Grain', grain);
    await sleep(1500); // the picker's preview write interval
    say(`portal: default space themed ${hex} strength ${s} grain ${g}`);
  } catch (e) {
    say(`portal: space theme failed: ${e.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { executable, features, isPortal, portalArgs, launchEnv, releaseOnboarding, visiblePage, openBackgroundTabs, themeSpace };
