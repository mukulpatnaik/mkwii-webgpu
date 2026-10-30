// Guest memory from the page, for drivers: an init script (page.addInitScript) that keeps the
// WebAssembly memories the page creates, so a route can read and write the game's own memory
// (big-endian, as on the console) without a special build.
//
//   window.__mkwGuest.r32(0x809B8F68)   // Racedata pointer (NTSC-U)
//   window.__mkwGuest.w32(addr, value)
//
// The runtime keeps MEM1 (0x80000000, 24 MiB) and MEM2 (0x90000000, 64 MiB) in two zeroed buffers
// of the wasm heap (runtime/src/guest_flat_memory_wasm.cpp in the fork). MEM1 is found by its first
// word, the disc's game code (written at boot); MEM2 by the Racedata object the game keeps there:
// the buffer where Racedata's pointer lands on its vtable and 36 player records sharing one vtable.
// So MEM2 is reachable once the game has made Racedata, a little after the title screen.
//
// autodrive('ghost'): the game's own ghost replay as a TAS on the player's kart. In a Time Trial
// set up with "Race This Ghost", the menu scenario of Racedata (the race setup the race scene is
// built from) has player 0 as a local player and player 1 as the ghost. Turning player 0 into a
// ghost and player 1 into nobody before the race loads makes the game read the ghost's recorded
// inputs (its first ghost slot, the staff ghost) for player 0, frame by frame from the race's
// first frame as it does for any ghost, while the race keeps the Time Trial screens: the normal
// camera and HUD. Racedata layout (mkw decomp): scenarios at +0x20 (race) and +0xC10 (menu), 0xBF0
// each; players at scenario+0x8, 0xF0 each, type at +0x10 (0 local, 1 CPU, 3 ghost, 5 none);
// settings at scenario+0xB48, game mode at +0x8 (2 Time Trial). The ghost player is written into
// the menu scenario when the Start Race OK is pressed, about 0.4 s before the race scene copies it,
// so the check runs every 5 ms; arm it on the OK screen, then press OK.
module.exports = String.raw`(() => {
  const mems = [];
  const OrigMemory = WebAssembly.Memory;
  const keep = (m) => { if (m instanceof OrigMemory && !mems.includes(m)) mems.push(m); };
  WebAssembly.Memory = function Memory(desc) { const m = new OrigMemory(desc); keep(m); return m; };
  WebAssembly.Memory.prototype = OrigMemory.prototype;
  for (const k of ['instantiate', 'instantiateStreaming']) {
    const orig = WebAssembly[k];
    WebAssembly[k] = async function (...a) {
      const r = await orig.apply(this, a);
      const exp = (r.instance || r).exports || {};
      Object.values(exp).forEach(keep);
      return r;
    };
  }
  let heap = null, base1 = -1, base2 = -1;
  const GAME_CODE = 0x524d4345; // "RMCE"
  const RACEDATA = 0x809B8F68, SCEN = {race: 0x20, menu: 0xC10};
  const view = () => {
    const m = mems.reduce((a, b) => (!a || b.buffer.byteLength > a.buffer.byteLength ? b : a), null);
    if (!m) return null;
    if (!heap || heap.buffer !== m.buffer) heap = new Uint8Array(m.buffer);
    return heap;
  };
  const be32 = (h, o) => ((h[o] << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) >>> 0;
  const findMem1 = (h) => {
    if (base1 >= 0 && be32(h, base1) === GAME_CODE) return base1;
    base1 = -1;
    for (let o = 0; o + 0x1800000 <= h.length; o += 0x1000) {
      // The game code, then the maker "01".
      if (h[o] === 0x52 && be32(h, o) === GAME_CODE && h[o + 4] === 0x30 && h[o + 5] === 0x31) { base1 = o; break; }
    }
    return base1;
  };
  // Racedata's own vtable, then 36 player records (three scenarios of 12) that share one vtable.
  const inMem1 = (v) => v >= 0x80000000 && v < 0x81800000;
  const isRacedata = (h, o) => {
    if (o < 0 || o + 0x2400 > h.length || !inMem1(be32(h, o))) return false;
    const pvt = be32(h, o + 0x28);
    if (!inMem1(pvt)) return false;
    for (const s of [0x20, 0xC10, 0x1800]) {
      for (let i = 0; i < 12; i++) {
        const p = o + s + 0x8 + i * 0xF0;
        if (be32(h, p) !== pvt || be32(h, p + 0x10) > 5) return false;
      }
    }
    return true;
  };
  const findMem2 = (h) => {
    const rd = be32(h, findMem1(h) + (RACEDATA - 0x80000000));
    if (rd < 0x90000000 || rd >= 0x94000000) return -1;
    const off = rd - 0x90000000;
    if (base2 >= 0 && isRacedata(h, base2 + off)) return base2;
    base2 = -1;
    for (let o = 0; o + 0x4000000 <= h.length; o += 0x1000) if (isRacedata(h, o + off)) { base2 = o; break; }
    return base2;
  };
  const at = (addr) => {
    const h = view();
    if (!h) throw new Error('no wasm memory yet');
    addr >>>= 0;
    if (addr >= 0x80000000 && addr < 0x81800000) {
      if (findMem1(h) < 0) throw new Error('MEM1 not found');
      return base1 + (addr - 0x80000000);
    }
    if (addr >= 0x90000000 && addr < 0x94000000) {
      if (findMem1(h) < 0 || findMem2(h) < 0) throw new Error('MEM2 not found');
      return base2 + (addr - 0x90000000);
    }
    throw new Error('not in MEM1 or MEM2: 0x' + addr.toString(16));
  };
  const r32 = (addr) => be32(view(), at(addr));
  const f32buf = new DataView(new ArrayBuffer(4));
  const rf32 = (addr) => { f32buf.setUint32(0, r32(addr)); return f32buf.getFloat32(0); };
  const w32 = (addr, v) => { const h = view(), o = at(addr); h[o] = v >>> 24; h[o + 1] = v >>> 16; h[o + 2] = v >>> 8; h[o + 3] = v; };

  const player = (rd, scen, i) => rd + SCEN[scen] + 0x8 + i * 0xF0;
  const scenario = (scen) => {
    const rd = r32(RACEDATA);
    if (!rd) return null;
    return {mode: r32(rd + SCEN[scen] + 0xB48 + 0x8), types: Array.from({length: 12}, (_, i) => r32(player(rd, scen, i) + 0x10))};
  };
  let timer = null;
  const autodrive = (kind) => {
    clearInterval(timer);
    if (kind !== 'ghost') return 'off';
    timer = setInterval(() => {
      try {
        const rd = r32(RACEDATA);
        if (!rd) return;
        const s = scenario('menu');
        if (s.mode === 2 && s.types[0] === 0 && s.types[1] === 3) {
          w32(player(rd, 'menu', 0) + 0x10, 3);
          w32(player(rd, 'menu', 1) + 0x10, 5);
          console.log('[autodrive] ghost: player 0 now reads the ghost inputs, player 1 removed');
        }
      } catch (e) { /* not booted yet */ }
    }, 5);
    return 'armed';
  };
  window.__mkwGuest = {r32, rf32, w32, scenario, autodrive};
})();`;
