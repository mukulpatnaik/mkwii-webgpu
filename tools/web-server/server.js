// SPDX-License-Identifier: GPL-3.0-or-later
// mkw-web: a one-file local server for the private browser build of Mario Kart Wii.
//
// It serves the page files (built into the executable by scripts/build-web-server.sh, or a folder
// given with --site), with the headers a threaded WebAssembly page needs (cross-origin isolation)
// and byte ranges, and offers the owner's disc image to the page so nothing has to be picked. It
// listens on 127.0.0.1 only: the game and the disc stay on this machine.
//
//   mkw-web [disc image] [--port 8010] [--no-open] [--site DIR]
//
// Without a disc argument it uses the first .wbfs/.iso/.ciso/.gcm next to the executable (or in
// the current folder); without any, the page asks the player to pick one as usual.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { embeddedFiles } from './assets.js';

const DISC_PATH = '/mkw-server-disc';
const DISC_INFO = '/mkw-server-disc.json';
const DISC_EXTENSIONS = ['.wbfs', '.iso', '.ciso', '.gcm'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.json': 'application/json',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png',
};

function usage(message) {
  if (message) console.error(message);
  console.error('usage: mkw-web [disc image] [--port N] [--no-open] [--site DIR]');
  process.exit(2);
}

const options = { port: 8010, open: true, site: '', disc: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--port') options.port = Number(argv[++i]);
  else if (arg === '--no-open') options.open = false;
  else if (arg === '--site') options.site = argv[++i] || usage('--site needs a folder');
  else if (arg === '-h' || arg === '--help') usage();
  else if (arg.startsWith('-')) usage('unknown option ' + arg);
  else options.disc = arg;
}
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) usage('bad --port');

// The folder the executable sits in (a compiled Bun binary runs from a virtual /$bunfs path).
const compiled = import.meta.path.includes('$bunfs') || import.meta.path.startsWith('B:');
const homeDir = compiled ? path.dirname(process.execPath) : process.cwd();

function findDisc() {
  if (options.disc) {
    if (!existsSync(options.disc) || !statSync(options.disc).isFile()) usage('no such disc image: ' + options.disc);
    return path.resolve(options.disc);
  }
  for (const dir of [...new Set([homeDir, process.cwd()])]) {
    const found = readdirSync(dir).filter((name) => DISC_EXTENSIONS.includes(path.extname(name).toLowerCase())).sort();
    if (found.length) return path.join(dir, found[0]);
  }
  return '';
}

// URL path -> Bun file. Embedded files first; --site replaces them with a folder on disk.
const files = new Map();
if (options.site) {
  const root = path.resolve(options.site);
  for (const name of readdirSync(root)) {
    if (statSync(path.join(root, name)).isFile()) files.set('/' + name, Bun.file(path.join(root, name)));
  }
} else {
  for (const [name, embedded] of Object.entries(embeddedFiles)) files.set('/' + name, Bun.file(embedded));
}
if (!files.has('/WiiCompiled.html')) {
  usage(options.site ? 'no WiiCompiled.html in ' + options.site
                     : 'this mkw-web was built without the page files; pass --site DIR');
}

const discPath = findDisc();
const disc = discPath ? Bun.file(discPath) : null;

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// One file, whole or a single byte range ("bytes=a-b", "bytes=a-", "bytes=-n").
function serveFile(request, file, type) {
  const size = file.size;
  const headers = { ...isolation, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = request.headers.get('range');
  if (!range) {
    headers['Content-Length'] = String(size);
    return new Response(request.method === 'HEAD' ? null : file, { headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (match && match[1] !== '') {
    start = Number(match[1]);
    end = match[2] !== '' ? Math.min(Number(match[2]), size - 1) : size - 1;
  } else if (match && match[2] !== '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (start === undefined || !(start <= end) || start >= size) {
    return new Response(null, { status: 416, headers: { ...isolation, 'Content-Range': 'bytes */' + size } });
  }
  headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  headers['Content-Length'] = String(end - start + 1);
  return new Response(request.method === 'HEAD' ? null : file.slice(start, end + 1), { status: 206, headers });
}

function handle(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: isolation });
  }
  const url = new URL(request.url);
  let name = decodeURIComponent(url.pathname);
  if (name === '/') name = '/WiiCompiled.html';
  if (name === DISC_INFO) {
    if (!disc) return new Response('no disc image offered', { status: 404, headers: isolation });
    return Response.json({ url: DISC_PATH.slice(1), size: disc.size, name: path.basename(discPath) },
                         { headers: { ...isolation, 'Cache-Control': 'no-store' } });
  }
  if (name === DISC_PATH && disc) return serveFile(request, disc, 'application/octet-stream');
  const file = files.get(name);
  if (!file) return new Response('not found', { status: 404, headers: isolation });
  return serveFile(request, file, TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');
}

// The chosen port, or the next free one.
let server;
for (let port = options.port; port < options.port + 20 && !server; port++) {
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port, fetch: handle });
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' && !/in use/i.test(String(error?.message))) throw error;
  }
}
if (!server) usage(`ports ${options.port}-${options.port + 19} are all in use`);

const pageUrl = `http://localhost:${server.port}/WiiCompiled.html`;
console.log(`Mario Kart Wii (private build) at ${pageUrl}`);
console.log(disc ? `Disc image: ${discPath} (${(disc.size / 2 ** 30).toFixed(2)} GiB), read in the page from this machine`
                 : 'No disc image found next to mkw-web: the page will ask you to pick one.');
console.log('Open it in Google Chrome or Microsoft Edge. Press Ctrl+C to stop.');

if (options.open) {
  const open = process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', pageUrl]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', pageUrl]]
    : ['sh', ['-c', 'for b in google-chrome google-chrome-stable chromium microsoft-edge; do command -v "$b" >/dev/null && exec "$b" "$0"; done; exec xdg-open "$0"', pageUrl]];
  const child = spawn(open[0], open[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.on('exit', (code) => {
    // No Chrome under that name on macOS: let the default browser try.
    if (code && process.platform === 'darwin') spawn('open', [pageUrl], { stdio: 'ignore', detached: true }).on('error', () => {});
  });
  child.unref();
}
