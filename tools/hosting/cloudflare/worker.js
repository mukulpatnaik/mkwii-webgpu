// SPDX-License-Identifier: GPL-3.0-or-later
// Cloudflare Worker that serves a staged release folder (tools/hosting/stage-release.sh) from a
// private R2 bucket, the way the local servers do: cross-origin isolation headers on every
// response (threads need SharedArrayBuffer), single byte ranges for the lazily read disc files,
// application/wasm for the game, and a /log sink for pages opened with ?log.
//
// The bucket holds translated game code (the owner's build is public since 2026-11-09; README,
// "Legal"). A staged game folder adds files from the owner's disc: only ever behind Cloudflare
// Access (docs/hosting.md).
//
// Binding: BUCKET (R2). Configuration: tools/hosting/cloudflare/wrangler.jsonc.in.

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  css: 'text/css; charset=utf-8',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const LOG_LIMIT = 64 * 1024;

// How long a browser may keep a file without asking again. Content-addressed packs and menu
// previews never change under their name; the extracted disc (game/DATA) never changes either,
// but a day keeps a redeploy of a different dump honest; everything else revalidates.
function cacheControl(key) {
  if (/^game\/(file-packs|web-videos)\/[0-9a-f]{64}\.(bin|thp)$/.test(key)) return 'private, max-age=31536000, immutable';
  if (key.startsWith('game/DATA/')) return 'private, max-age=86400';
  return 'private, no-cache';
}

function contentType(key) {
  const dot = key.lastIndexOf('.');
  return (dot >= 0 && CONTENT_TYPES[key.slice(dot + 1).toLowerCase()]) || 'application/octet-stream';
}

// The game's file system joins its mount point and file paths with an extra slash
// (game//DATA/sys/fst.bin); R2 keys are exact strings, so collapse runs of slashes.
function keyFor(pathname) {
  return decodeURIComponent(pathname).replace(/\/{2,}/g, '/').replace(/^\//, '');
}

function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ISOLATION, ...extra } });
}

// Pages opened with ?log forward their console here in small batches; they show up in
// `wrangler tail`. Bounded so a runaway page cannot stream for ever.
async function sink(request) {
  if (request.method !== 'POST') return text(405, 'Method not allowed', { Allow: 'POST' });
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > LOG_LIMIT) return text(413, 'Diagnostic batch too large');
  const reader = request.body ? request.body.getReader() : null;
  if (!reader) return new Response(null, { status: 204, headers: ISOLATION });
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > LOG_LIMIT) {
      await reader.cancel();
      return text(413, 'Diagnostic batch too large');
    }
    parts.push(value);
  }
  const decoder = new TextDecoder();
  console.log('[browser]', parts.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode());
  return new Response(null, { status: 204, headers: ISOLATION });
}

// Where to send the root: the landing page when the site has one, else the game page.
async function root(url, env) {
  let landing = null;
  try { landing = await env.BUCKET.head('index.html'); } catch { landing = null; }
  return Response.redirect(new URL(landing ? '/index.html' : '/WiiCompiled.html', url).href, 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/log') return sink(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    if (url.pathname === '/') return root(url, env);

    let key;
    try {
      key = keyFor(url.pathname);
    } catch {
      return text(400, 'Invalid path');
    }
    if (!key) return root(url, env);

    let object;
    try {
      // R2 applies If-None-Match and Range itself: a satisfied precondition comes back as a
      // body-less object, an impossible range as an exception.
      object = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    } catch {
      return text(416, 'Range not satisfiable');
    }
    if (!object) return text(404, 'Not found');

    const headers = new Headers({
      ...ISOLATION,
      'Content-Type': contentType(key),
      'Cache-Control': cacheControl(key),
      'Accept-Ranges': 'bytes',
      ETag: object.httpEtag,
    });
    if (!('body' in object)) return new Response(null, { status: 304, headers });

    const body = request.method === 'HEAD' ? null : object.body;
    const range = request.headers.has('Range') ? object.range : null;
    if (!range) {
      headers.set('Content-Length', String(object.size));
      return new Response(body, { status: 200, headers });
    }
    // R2 range descriptors are {offset, length} or {suffix}; absent fields may be present
    // with the value undefined, so test the values, not the keys.
    const size = object.size;
    let start, length;
    if (typeof range.suffix === 'number') {
      length = Math.min(range.suffix, size);
      start = size - length;
    } else {
      start = typeof range.offset === 'number' ? range.offset : 0;
      length = typeof range.length === 'number' ? Math.min(range.length, size - start) : size - start;
    }
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(body, { status: 206, headers });
  },
};
