#!/usr/bin/env python3
"""Summarise a Chrome trace from pace-drive.js "trace": how the game's canvas frames line up with
the display. Ground truth from Chrome itself, outside the page:
  * vsync ticks: viz DelayBasedBeginFrameSource::OnTimerTick (or BeginFrame events),
  * canvas frames: blink OffscreenCanvas::PushFrame on the game's worker thread,
  * displayed frames: Display::FrameDisplayed.
Prints pushes per vsync interval (ideal at 60 Hz: all 1), the interval between pushes in vsync
units (ideal: all equal), and their spread.
Usage: frame-trace.py trace.json [more.json ...]"""
import json, sys, statistics, collections

def load(path):
    d = json.load(open(path))
    return d['traceEvents'] if isinstance(d, dict) else d

def summarise(path):
    ev = load(path)
    ticks = sorted(e['ts'] for e in ev if e.get('name') == 'DelayBasedBeginFrameSource::OnTimerTick' and e.get('ph') in ('X', 'B'))
    if len(ticks) < 10:
        ticks = sorted(e['ts'] for e in ev if e.get('name') == 'DisplayScheduler::BeginFrame' and e.get('ph') in ('X', 'B'))
    pushes = sorted(e['ts'] for e in ev if e.get('name') == 'OffscreenCanvas::PushFrame' and e.get('ph') in ('X', 'B'))
    shown = sorted(e['ts'] for e in ev if e.get('name') == 'Display::FrameDisplayed')
    if len(ticks) < 3 or len(pushes) < 3:
        print(f'{path}: not enough events (ticks={len(ticks)} pushes={len(pushes)})'); return
    span = (ticks[-1] - ticks[0]) / 1e6
    tick_iv = [(b - a) / 1000 for a, b in zip(ticks, ticks[1:])]
    period = statistics.median(tick_iv)
    # Pushes per vsync interval [tick i, tick i+1).
    per = collections.Counter()
    j = 0
    p = [x for x in pushes if ticks[0] <= x < ticks[-1]]
    counts = []
    for a, b in zip(ticks, ticks[1:]):
        n = 0
        while j < len(p) and p[j] < b:
            if p[j] >= a: n += 1
            j += 1
        counts.append(n)
    per.update(counts)
    push_iv = [(b - a) / 1000 for a, b in zip(p, p[1:])]
    in_vsyncs = collections.Counter(max(0, round(x / period)) for x in push_iv)
    # Phase of each push inside its vsync interval (ms after the tick).
    phases = []
    k = 0
    for x in p:
        while k + 1 < len(ticks) and ticks[k + 1] <= x: k += 1
        phases.append((x - ticks[k]) / 1000)
    print(f'{path}: {span:.1f} s, vsync {1000/period:.2f} Hz ({len(ticks)} ticks), canvas pushes {len(p)} '
          f'({len(p)/span:.1f}/s), frames displayed {len(shown)}')
    print('  pushes per vsync interval: ' + ' '.join(f'{k}:{v}' for k, v in sorted(per.items())))
    print('  push-to-push interval in vsyncs: ' + ' '.join(f'{k}:{v}' for k, v in sorted(in_vsyncs.items())))
    print(f'  push-to-push ms: mean {statistics.mean(push_iv):.2f} stdev {statistics.pstdev(push_iv):.2f} '
          f'min {min(push_iv):.2f} max {max(push_iv):.2f}')
    print(f'  push phase after vsync tick ms: mean {statistics.mean(phases):.2f} stdev {statistics.pstdev(phases):.2f} '
          f'min {min(phases):.2f} max {max(phases):.2f}')
    # Runs of 0 or 2+ pushes in a vsync are what a viewer sees as a repeated or skipped frame.
    print(f'  vsyncs with no new frame: {per[0]}, with 2+ new frames: {sum(v for k, v in per.items() if k >= 2)}')

for path in sys.argv[1:]:
    summarise(path)
