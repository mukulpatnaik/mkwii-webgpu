// A capture is what tools/video/capture.sh leaves in public/captures/<name>/: capture.mp4,
// meta.json (window, length) and perf.json (fps samples and route marks on the video's clock,
// from scripts/perf-to-json.mjs). Captures show the game and are never committed, so every
// composition also renders without them (a placeholder card says which capture is missing).
import {staticFile} from 'remotion';

export type PerfSample = {t: number; fps: number; frames: number};
export type Marker = {t: number; name: string};
export type Perf = {
  capture: string;
  durationSec: number;
  offsetSec: number;
  samples: PerfSample[];
  markers: Marker[];
  raceStartSec: number | null;
  fpsMin: number | null;
  fpsMedian: number | null;
};
export type Meta = {
  name: string;
  durationSec: number;
  fps: number;
  window: {x: number; y: number; width: number; height: number};
};
export type Capture = {name: string; src: string; meta: Meta; perf: Perf};

export const CAPTURE_NAMES = ['boot', 'race', 'multiplayer'] as const;
export type CaptureName = (typeof CAPTURE_NAMES)[number];

const fetchJson = async (name: string, file: string) => {
  const res = await fetch(staticFile(`captures/${name}/${file}`));
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  return res.json();
};

export const loadCapture = async (name: CaptureName): Promise<Capture | null> => {
  try {
    const [meta, perf] = await Promise.all([fetchJson(name, 'meta.json'), fetchJson(name, 'perf.json')]);
    if (!meta || !perf) return null;
    return {name, src: staticFile(`captures/${name}/capture.mp4`), meta, perf};
  } catch {
    return null;
  }
};

export const markerTime = (c: Capture, name: string): number | null =>
  c.perf.markers.find((m) => m.name === name)?.t ?? null;
