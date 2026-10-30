#!/usr/bin/env node
// Turn a capture's console.log into perf.json on the video's clock (video/README.md).
//
//   node video/scripts/perf-to-json.mjs video/public/captures/race
//
// console.log lines are `[seconds since the driver started] [type] text`. The first line gives the
// driver's epoch time and meta.json gives ffmpeg's, so every console time becomes a time in
// capture.mp4. Collected: every `[web-perf] fps=` sample (the page's own 3-second average),
// the driver's marks (`[driver] mark <name>`, the Start click, page loads), the room and relay
// `[vnet]` lines of online play (the relay connection) as events, and the first
// `[web-pace] race steps/s` line at race pace, as a fallback race start. Two marks come from the
// game's own console lines, since no route command can know when they happen: `title-loaded`
// (the disc read of Scene/UI/Title.szs, right before the title screen) and `race-loaded` (the
// first `[web-warm] course file` line, when a race's course is loaded).
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: perf-to-json.mjs <capture dir>'); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const lines = fs.readFileSync(path.join(dir, 'console.log'), 'utf8').split('\n');

const t0 = Number((lines[0].match(/\[driver\] t0 epoch_ms=(\d+)/) || [])[1]);
if (!t0) { console.error('console.log does not start with the driver t0 line'); process.exit(1); }
const offset = (t0 - meta.ffmpegStartEpochMs) / 1000; // console time + offset = video time
const toVideo = (s) => Math.round((Number(s) + offset) * 1000) / 1000;

const samples = [], markers = [], events = [];
let raceStart = null;
for (const line of lines) {
  const m = line.match(/^\[\s*([\d.]+)\] \[(\w+)\] (.*)$/);
  if (!m) continue;
  const [, t, type, text] = m;
  let f;
  if (type === 'driver') {
    // The driver's own lines: `mark <name>`, `clicked #start`, `goto <url>`, `t0 ...`.
    if ((f = text.match(/^mark (.+)$/))) markers.push({ t: toVideo(t), name: f[1].trim() });
    else if (text.startsWith('clicked #start')) markers.push({ t: toVideo(t), name: 'start-clicked' });
    else if (text.startsWith('goto ')) markers.push({ t: toVideo(t), name: 'goto' });
  } else if ((f = text.match(/^\[web-perf\] fps=([\d.]+) frames=(\d+)/))) {
    samples.push({ t: toVideo(t), fps: Number(f[1]), frames: Number(f[2]) });
  } else if ((text.includes('RVL_SDK - THP') || (text.startsWith('[web-disc] read took') && text.includes('/Scene/UI/Title.szs')))
             && !markers.some((k) => k.name === 'title-loaded')) {
    // The title scene: the game's THP (movie) library announces itself as that scene starts, and
    // a slow disc read of Scene/UI/Title.szs is logged just before it.
    markers.push({ t: toVideo(t), name: 'title-loaded' });
  } else if (text.startsWith('[web-warm] course file') && !markers.some((k) => k.name === 'race-loaded')) {
    markers.push({ t: toVideo(t), name: 'race-loaded' });
  } else if (raceStart === null && (f = text.match(/^\[web-pace\] race steps\/s=([\d.]+)/)) && Number(f[1]) >= 30) {
    raceStart = toVideo(t) - 3; // the line sums the previous three seconds
  }
  // Online play: the relay lines, for a ticker over the footage (text as printed).
  if (/^\[vnet\]/.test(text)) {
    events.push({ t: toVideo(t), text: text.replace(/\s+/g, ' ').slice(0, 120) });
  }
}
const perf = {
  capture: meta.name,
  durationSec: meta.durationSec,
  offsetSec: offset,
  samples,
  markers,
  events,
  raceStartSec: raceStart,
  fpsMin: samples.length ? Math.min(...samples.map((s) => s.fps)) : null,
  fpsMedian: samples.length ? [...samples.map((s) => s.fps)].sort((a, b) => a - b)[samples.length >> 1] : null,
};
fs.writeFileSync(path.join(dir, 'perf.json'), JSON.stringify(perf, null, 2) + '\n');
console.log(`perf.json: ${samples.length} fps samples, ${markers.length} marks` +
  (markers.length ? ` (${markers.map((m) => `${m.name}@${m.t.toFixed(1)}s`).join(', ')})` : '') +
  (raceStart !== null ? `, race pace from ${raceStart.toFixed(1)}s` : ''));
