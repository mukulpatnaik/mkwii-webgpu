// Node test for the disc wasm: opens an image through the same read-callback ABI a browser
// worker would use with FileReaderSync, prints the game ID, lists the FST, reads main.dol and
// StaticR.rel and hashes them. Usage: node test.mjs <image> [expected-dol-sha256]
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [image, expectedDol] = process.argv.slice(2);
if (!image) { console.error('usage: node test.mjs <image>'); process.exit(2); }
const fd = fs.openSync(image, 'r');
const size = fs.fstatSync(fd).size;

let memory;
let readCalls = 0, readBytes = 0;
const wasmBytes = fs.readFileSync(new URL('./target/wasm32-unknown-unknown/release/mkw_disc_wasm.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: {
    host_read_at(ptr, len, lo, hi) {
      const offset = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
      const view = new Uint8Array(memory.buffer, ptr, len);
      let done = 0;
      while (done < len) {
        const n = fs.readSync(fd, view, done, len - done, Number(offset) + done);
        if (n <= 0) return 1;
        done += n;
      }
      readCalls++; readBytes += len;
      return 0;
    },
  },
});
const e = instance.exports;
memory = e.memory;
const u8 = () => new Uint8Array(memory.buffer);
const err = () => { const cap = 512, p = e.disc_alloc(cap); const n = e.disc_last_error(p, cap); const s = new TextDecoder().decode(u8().subarray(p, p + Math.min(n, cap))); e.disc_free(p, cap); return s; };

let t = performance.now();
if (e.disc_open(size >>> 0, Math.floor(size / 2 ** 32) >>> 0) !== 0) { console.error('open failed:', err()); process.exit(1); }
const idPtr = e.disc_alloc(6); e.disc_game_id(idPtr);
console.log(`game id: ${new TextDecoder().decode(u8().subarray(idPtr, idPtr + 6))}  (open ${(performance.now() - t).toFixed(0)} ms, ${readCalls} reads, ${(readBytes / 1e6).toFixed(1)} MB)`);

t = performance.now();
let cap = 1 << 20, p = e.disc_alloc(cap);
let n = e.disc_list_files(p, cap);
if (n > cap) { e.disc_free(p, cap); cap = n; p = e.disc_alloc(cap); n = e.disc_list_files(p, cap); }
const list = new TextDecoder().decode(u8().subarray(p, p + n)).trimEnd().split('\n');
e.disc_free(p, cap);
const total = list.reduce((a, l) => a + Number(l.split('\t')[0]), 0);
console.log(`fst: ${list.length} files, ${(total / 2 ** 30).toFixed(2)} GiB  (${(performance.now() - t).toFixed(0)} ms)`);
console.log('  e.g.', list.slice(0, 3).map((l) => l.split('\t')[1]).join(', '));

function readWhole(which, path) {
  const enc = new TextEncoder().encode(path || '');
  const pp = e.disc_alloc(enc.length || 1); u8().set(enc, pp);
  let cap = 4 << 20, out = e.disc_alloc(cap);
  const t0 = performance.now(); readCalls = 0; readBytes = 0;
  let len = Number(e.disc_read(which, pp, enc.length, out, cap));
  if (len < 0) throw new Error(err());
  if (len > cap) { e.disc_free(out, cap); cap = len; out = e.disc_alloc(cap); len = Number(e.disc_read(which, pp, enc.length, out, cap)); }
  const data = Buffer.from(u8().subarray(out, out + len));
  e.disc_free(out, cap); e.disc_free(pp, enc.length || 1);
  const sha = createHash('sha256').update(data).digest('hex');
  console.log(`${path || 'main.dol'}: ${len} bytes sha256=${sha}  (${(performance.now() - t0).toFixed(0)} ms, ${readCalls} reads, ${(readBytes / 1e6).toFixed(1)} MB from image)`);
  return sha;
}
const dol = readWhole(1);
readWhole(0, 'rel/StaticR.rel');
readWhole(0, 'Race/Course/castle_course.szs');
if (expectedDol) console.log(expectedDol === dol ? 'main.dol hash MATCHES expected' : 'main.dol hash DIFFERS from expected');
