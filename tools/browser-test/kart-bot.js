// A driving bot for the demo captures: an init script (after guest-memory.js) that drives the local
// player's kart through an ordinary controller, the way a person would, so the game keeps the
// player's chase camera and HUD and online play works as usual.
//
//   window.__mkwBot.start()   // from the Start Race screen or any time before GO; stop() releases
//
// Every 16 ms it reads the kart's position and rotation and the course's CPU route from the game's
// memory (window.__mkwGuest), steers towards a point on the route a little ahead (pure pursuit),
// holds accelerate once the race is on (it logs `[bot] go` on the first racing frame, the video's
// mark for GO) and uses whatever item it has every few seconds. Input goes
// through a fake standard gamepad (navigator.getGamepads), which the page puts on port 1 next to the
// keyboard: analog steering, A to accelerate, the left trigger for items.
//
// Memory layout (NTSC-U; offsets from the mkw decomp and MKW-SP's headers, addresses checked in the
// translated code): Kart::Manager at 0x809BD110, karts at +0x20; a kart's physics is
// [[[[kart]+0x8]+0x90]+0x4], position at +0x68, rotation quaternion (x, y, z, w) at +0xF0.
// CourseMap at 0x809B8F28: CPU paths (ENPH) at +0xC, CPU route points (ENPT) at +0x10, each an
// accessor {entries, count << 16}; a path entry is {data}, a point entry {vtable, data}. ENPT data is
// a position and a width, ENPH data is first point, point count, 6 previous paths, 6 next paths. Raceinfo at 0x809B8F70: race stage at
// +0x28 (0 intro, 1 countdown, 2 racing, 3 finished). Racedata's race scenario says which player is
// the local one (type 0).
module.exports = String.raw`(() => {
  const KARTS = 0x809BD110, COURSE = 0x809B8F28, RACEINFO = 0x809B8F70, RACEDATA = 0x809B8F68;
  const G = () => window.__mkwGuest;
  const r8 = (a) => (G().r32(a & ~3) >>> (24 - 8 * (a & 3))) & 0xff;

  // The fake pad: standard mapping, A = buttons[0], LT = buttons[6], left stick = axes[0..1].
  const pad = {
    id: 'kart-bot (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], vibrationActuator: null,
    buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0})),
  };
  let padOn = false;
  const realGetGamepads = Navigator.prototype.getGamepads;
  Navigator.prototype.getGamepads = function () {
    if (!padOn) return realGetGamepads.call(this);
    return [{...pad, axes: [...pad.axes], buttons: pad.buttons.map((b) => ({...b}))}];
  };
  const button = (n, on) => { pad.buttons[n] = {pressed: on, touched: on, value: on ? 1 : 0}; pad.timestamp = performance.now(); };
  // The page's dead zone is 8000 of 32767: map |steer| 0..1 onto the live part of the stick.
  const stick = (x) => {
    const m = Math.min(1, Math.abs(x));
    pad.axes[0] = m < 0.02 ? 0 : Math.sign(x) * (0.26 + 0.74 * m);
    pad.timestamp = performance.now();
  };

  // The route: ENPT points in driving order, following each path's first next path.
  const route = () => {
    const cm = G().r32(COURSE);
    const acc = (off) => { const a = G().r32(cm + off); return {entries: G().r32(a), n: G().r32(a + 4) >>> 16}; };
    // An entry is {data} for paths but {vtable, data} for points: skip a vtable (MEM1) word.
    const data = (a, i) => {
      const e = G().r32(a.entries + 4 * i), w = G().r32(e);
      return w >= 0x80000000 && w < 0x81800000 ? G().r32(e + 4) : w;
    };
    const pts = acc(0x10), paths = acc(0xC);
    const point = (i) => { const d = data(pts, i); return {x: G().rf32(d), y: G().rf32(d + 4), z: G().rf32(d + 8), w: G().rf32(d + 12)}; };
    const order = [];
    const seen = new Set();
    for (let p = 0; p < paths.n && !seen.has(p);) {
      seen.add(p);
      const d = data(paths, p);
      const start = r8(d), size = r8(d + 1);
      for (let i = start; i < start + size; i++) order.push(point(i));
      const next = r8(d + 8);
      p = next === 0xff ? 0 : next;
    }
    return order;
  };
  const localPlayer = () => {
    const rd = G().r32(RACEDATA);
    for (let i = 0; i < 12; i++) if (G().r32(rd + 0x20 + 0x8 + i * 0xF0 + 0x10) === 0) return i;
    return 0;
  };
  const kart = (id) => {
    const k = G().r32(G().r32(KARTS + 0) + 0x20);
    const ph = G().r32(G().r32(G().r32(G().r32(G().r32(k + 4 * id)) + 0x8) + 0x90) + 0x4);
    const f = (o) => G().rf32(ph + o);
    const [qx, qy, qz, qw] = [f(0xF0), f(0xF4), f(0xF8), f(0xFC)];
    // The kart's forward axis (local +Z) in world space.
    return {x: f(0x68), y: f(0x6C), z: f(0x70), fx: 2 * (qx * qz + qw * qy), fz: 1 - 2 * (qx * qx + qy * qy)};
  };

  let timer = null, pts = null, idx = -1, me = 0, ticks = 0, last = null, prev = null, facing = 1, agree = 0, went = false;
  const opts = {lookahead: 2200, gain: 2.2, itemEvery: 180, steerSign: -1};
  const tick = () => {
    try {
      const stage = G().r32(G().r32(RACEINFO) + 0x28);
      if (!pts) {
        if (stage < 1) return;
        pts = route(); me = localPlayer();
        console.log('[bot] route ' + pts.length + ' points, driving player ' + me);
      }
      const k = kart(me);
      // Which way the rotation's +Z points relative to the direction of travel, learnt from the
      // kart's own movement while it is moving forward under acceleration.
      if (prev) {
        const mx = k.x - prev.x, mz = k.z - prev.z, m = Math.hypot(mx, mz);
        if (m > 8) { agree += Math.sign(mx * k.fx + mz * k.fz); agree = Math.max(-30, Math.min(30, agree)); facing = agree < 0 ? -1 : 1; }
      }
      prev = {x: k.x, z: k.z};
      k.fx *= facing; k.fz *= facing;
      // Progress: the nearest route point at or a little ahead of the last one.
      const d2 = (p) => (p.x - k.x) ** 2 + (p.z - k.z) ** 2;
      if (idx < 0) { idx = 0; pts.forEach((p, i) => { if (d2(p) < d2(pts[idx])) idx = i; }); }
      for (let n = 1; n < 12; n++) { const j = (idx + n) % pts.length; if (d2(pts[j]) < d2(pts[idx])) idx = j; }
      // Target: the first route point after the nearest one that is at least the lookahead distance
      // away and in front of the kart.
      const ahead = (p) => (p.x - k.x) * k.fx + (p.z - k.z) * k.fz > 0;
      let t = (idx + 1) % pts.length;
      for (let n = 0; n < pts.length && (d2(pts[t]) < opts.lookahead ** 2 || !ahead(pts[t])); n++) t = (t + 1) % pts.length;
      const dx = pts[t].x - k.x, dz = pts[t].z - k.z;
      const angle = Math.atan2(k.fz * dx - k.fx * dz, k.fx * dx + k.fz * dz);
      const racing = stage === 2;
      if (racing && !went) { went = true; console.log('[bot] go'); }
      stick(racing ? opts.steerSign * opts.gain * angle : 0);
      button(0, racing);
      ticks++;
      if (racing && ticks % opts.itemEvery === 0) button(6, true);
      if (ticks % opts.itemEvery === 6) button(6, false);
      if (ticks % 120 === 0) {
        const moved = last ? Math.hypot(k.x - last.x, k.z - last.z) : 0;
        last = {x: k.x, z: k.z};
        console.log('[bot] stage ' + stage + ' point ' + idx + '/' + pts.length + ' target ' + t + ' angle ' +
          (angle * 57.3).toFixed(0) + ' moved ' + moved.toFixed(0) + ' facing ' + facing + ' (' + agree + ')');
      }
      if (stage === 3) stop();
    } catch (e) { /* the race is not up yet */ }
  };
  const start = (o = {}) => {
    Object.assign(opts, o);
    stop();
    pts = null; idx = -1; ticks = 0; last = null; prev = null; facing = 1; agree = 0; went = false;
    padOn = true;
    const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e);
    timer = setInterval(tick, 16);
    return 'driving';
  };
  const stop = () => {
    clearInterval(timer); timer = null;
    stick(0); button(0, false); button(6, false);
    return 'stopped';
  };
  const debug = () => ({pts: route(), kart: kart(localPlayer())});
  window.__mkwBot = {start, stop, opts, debug};
})();`;
