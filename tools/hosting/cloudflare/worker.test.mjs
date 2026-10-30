// node --test tools/hosting/cloudflare/worker.test.mjs
// The Worker against a fake R2 bucket: path handling, headers, ranges, caching, the log sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const BYTES = new TextEncoder().encode('0123456789abcdef'); // 16 bytes

// A bucket holding the given keys, all with the same 16-byte content, behaving like R2 for the
// options the Worker passes (range and onlyIf as Headers).
function bucket(...keys) {
  const etag = '"etag-1"';
  return {
    async head(key) { return keys.includes(key) ? { size: BYTES.length, httpEtag: etag } : null; },
    async get(key, options = {}) {
      if (!keys.includes(key)) return null;
      const object = { size: BYTES.length, httpEtag: etag };
      if (options.onlyIf && options.onlyIf.get('If-None-Match') === etag) return object; // precondition: no body
      const header = options.range ? options.range.get('Range') : null;
      if (header) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!match) throw new Error('bad range');
        if (match[1] === '') {
          object.range = { offset: undefined, length: undefined, suffix: Number(match[2]) };
          object.body = BYTES.slice(Math.max(0, BYTES.length - Number(match[2])));
        } else {
          const offset = Number(match[1]);
          if (offset >= BYTES.length) throw new Error('unsatisfiable');
          const end = match[2] === '' ? BYTES.length - 1 : Math.min(Number(match[2]), BYTES.length - 1);
          object.range = { offset, length: end - offset + 1, suffix: undefined };
          object.body = BYTES.slice(offset, end + 1);
        }
      } else {
        object.body = BYTES;
      }
      return object;
    },
  };
}

const get = (path, init, env) => worker.fetch(new Request('https://mkw.test' + path, init), env);

test('the root goes to the game page, or to the landing page when the site has one', async () => {
  let response = await get('/', undefined, { BUCKET: bucket('WiiCompiled.html') });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://mkw.test/WiiCompiled.html');
  response = await get('/', undefined, { BUCKET: bucket('WiiCompiled.html', 'index.html') });
  assert.equal(response.headers.get('Location'), 'https://mkw.test/index.html');
});

test('runs of slashes and encoded slashes resolve to the exact R2 key', async () => {
  const env = { BUCKET: bucket('game/DATA/sys/fst.bin') };
  for (const path of ['/game/DATA/sys/fst.bin', '/game//DATA/sys/fst.bin', '/game///DATA//sys/fst.bin', '/game%2FDATA/sys/fst.bin']) {
    const response = await get(path, undefined, env);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), '0123456789abcdef');
  }
});

test('a missing key is 404 and malformed percent encoding is 400', async () => {
  const env = { BUCKET: bucket('WiiCompiled.js') };
  assert.equal((await get('/nothing.js', undefined, env)).status, 404);
  assert.equal((await get('/%E0%A4%A', undefined, env)).status, 400);
});

test('every file carries the isolation headers and its content type', async () => {
  const env = { BUCKET: bucket('WiiCompiled.wasm', 'WiiCompiled.html', 'game/manifest-v2.txt', 'mystery') };
  const wasm = await get('/WiiCompiled.wasm', undefined, env);
  assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
  assert.equal(wasm.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(wasm.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(wasm.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(wasm.headers.get('Content-Length'), '16');
  assert.equal(wasm.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await get('/WiiCompiled.html', undefined, env)).headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal((await get('/game/manifest-v2.txt', undefined, env)).headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal((await get('/mystery', undefined, env)).headers.get('Content-Type'), 'application/octet-stream');
});

test('HEAD answers with the headers and no body', async () => {
  const response = await get('/WiiCompiled.wasm', { method: 'HEAD' }, { BUCKET: bucket('WiiCompiled.wasm') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '16');
  assert.equal(await response.text(), '');
});

test('byte ranges: offset, open-ended, clamped, suffix, unsatisfiable', async () => {
  const env = { BUCKET: bucket('game/DATA/files/x.szs') };
  const range = (value) => get('/game/DATA/files/x.szs', { headers: { Range: value } }, env);
  let response = await range('bytes=2-5');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/16');
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(await response.text(), '2345');
  response = await range('bytes=10-');
  assert.equal(response.headers.get('Content-Range'), 'bytes 10-15/16');
  assert.equal(await response.text(), 'abcdef');
  response = await range('bytes=14-100');
  assert.equal(response.headers.get('Content-Range'), 'bytes 14-15/16');
  response = await range('bytes=-4');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 12-15/16');
  assert.equal(await response.text(), 'cdef');
  response = await range('bytes=-100');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-15/16');
  response = await range('bytes=99-');
  assert.equal(response.status, 416);
});

test('an unchanged object answers 304 without a body', async () => {
  const response = await get('/WiiCompiled.js', { headers: { 'If-None-Match': '"etag-1"' } }, { BUCKET: bucket('WiiCompiled.js') });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('ETag'), '"etag-1"');
  assert.equal(await response.text(), '');
});

test('caching: immutable packs and previews, a day for the disc, revalidate the rest', async () => {
  const pack = 'game/file-packs/' + 'a'.repeat(64) + '.bin';
  const video = 'game/web-videos/' + 'b'.repeat(64) + '.thp';
  const env = { BUCKET: bucket(pack, video, 'game/DATA/sys/fst.bin', 'game/manifest-v2.txt', 'WiiCompiled.wasm', 'game/save/rksys.dat') };
  const cache = async (key) => (await get('/' + key, undefined, env)).headers.get('Cache-Control');
  assert.equal(await cache(pack), 'private, max-age=31536000, immutable');
  assert.equal(await cache(video), 'private, max-age=31536000, immutable');
  assert.equal(await cache('game/DATA/sys/fst.bin'), 'private, max-age=86400');
  assert.equal(await cache('game/manifest-v2.txt'), 'private, no-cache');
  assert.equal(await cache('WiiCompiled.wasm'), 'private, no-cache');
  assert.equal(await cache('game/save/rksys.dat'), 'private, no-cache');
});

test('only GET and HEAD read files', async () => {
  const response = await get('/WiiCompiled.html', { method: 'POST', body: 'x' }, { BUCKET: bucket('WiiCompiled.html') });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  assert.equal((await get('/WiiCompiled.html', { method: 'DELETE' }, { BUCKET: bucket('WiiCompiled.html') })).status, 405);
});

test('the log sink takes bounded POST batches only', async (t) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  t.after(() => { console.log = original; });
  const env = { BUCKET: bucket() };
  assert.equal((await get('/log', undefined, env)).status, 405);
  assert.equal((await get('/log', { method: 'POST', body: '[web-perf] fps=60.0' }, env)).status, 204);
  assert.ok(lines.some((line) => line.includes('[web-perf] fps=60.0')));
  assert.equal((await get('/log', { method: 'POST', body: 'x'.repeat(70 * 1024) }, env)).status, 413);
  const declared = await get('/log', { method: 'POST', body: 'small', headers: { 'Content-Length': '1000000' } }, env);
  assert.equal(declared.status, 413);
});
