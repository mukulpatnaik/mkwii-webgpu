// Driving Portal (~/code/browser: a Chromium build with its own chrome) instead of Google Chrome.
// The dev build takes the usual Chromium switches and a debugging port; the packaged build drops
// the port, so only the dev build can be scripted. A fresh Portal profile boots in its onboarding
// lockdown (no new tab or page before sign-in), which the probe bridge on the root chrome page
// releases the way Portal's own smoke test does: completeOnboarding(), then the gate's release.
//
// Environment (tools/video/capture.sh sets these for MKW_BROWSER=portal):
//   MKW_CHROME       the browser executable (default /usr/bin/google-chrome)
//   MKW_PORTAL=1     the executable is Portal: open a debugging port and release onboarding
//   CHROME_ARGS      extra switches (space separated), e.g. Portal's --portal-chrome* switches
const executable = () => process.env.MKW_CHROME || '/usr/bin/google-chrome';
const isPortal = () => process.env.MKW_PORTAL === '1';
const port = () => 9340 + (Number(process.env.MKW_PORTAL_PORT_OFFSET) || 0); // read per launch
const portalArgs = () => (isPortal() ? [`--remote-debugging-port=${port()}`] : []);

// Chromium takes its X11 window class from CHROME_DESKTOP when a launcher set it; a fixed class
// lets a recorder find the window (xdotool search --class mkw-capture).
const launchEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.CHROME_DESKTOP;
  return env;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs `expression` on the root chrome page (chrome://portal/) over the debugging port.
async function evalOnRoot(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port()}/json`)).json();
  const root = targets.find((t) => t.url === 'chrome://portal/');
  if (!root) throw new Error('no chrome://portal/ target (is this a Portal build with --portal-chrome?)');
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
  await sleep(1000);
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

module.exports = { executable, isPortal, portalArgs, launchEnv, releaseOnboarding, visiblePage, themeSpace };
