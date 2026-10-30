// Where each composition cuts into the captures, in seconds of the capture, from the marks the
// routes leave (tools/browser-test/routes/demo-*.cmds): page, start-clicked, title, race-ok, go.
import {Capture, markerTime} from './captures';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const frames = (seconds: number) => Math.max(1, Math.round(seconds * FPS));

export type ClipWindow = {from: number; length: number; caption?: string};

const clamp = (c: Capture, from: number, length: number): {from: number; length: number} => {
  const start = Math.max(0, from);
  const end = Math.min(c.meta.durationSec, start + length);
  return {from: start, length: Math.max(0.5, end - start)};
};

// Boot: the page as it loads and Start is pressed, a cut to the title screen, and a few seconds
// of the opening movie the title drops into when nothing is pressed (about 15 s later).
export const bootClips = (c: Capture): ClipWindow[] => {
  const load = markerTime(c, 'goto') ?? 0;
  const start = markerTime(c, 'start-clicked') ?? load + 6;
  // The title screen follows the game's title-scene console line by about a second.
  const title = (markerTime(c, 'title-loaded') ?? start + 15) + 1.0;
  return [
    {
      ...clamp(c, load - 0.3, Math.min(12, start + 3.5 - (load - 0.3))),
      caption: 'A Chrome tab on a static site. The game is its own code, recompiled to WebAssembly.',
    },
    {...clamp(c, title, 6), caption: 'Rendered with WebGPU.'},
    {...clamp(c, title + 16.5, 6), caption: 'The opening movie plays too.'},
  ];
};

// Gameplay: the countdown and the first stretch of a 50cc Grand Prix race: the start, the first
// corner and the back straight. The scripted driver meets a wall about 18 s in, so the cut ends
// before that.
export const GAMEPLAY_SECONDS = 21;
export const gameplayClip = (c: Capture): ClipWindow => {
  const go = markerTime(c, 'go') ?? c.perf.raceStartSec ?? 0;
  return {...clamp(c, go - 3.5, GAMEPLAY_SECONDS), caption: 'Grand Prix, 50cc, Luigi Circuit, 12 karts.'};
};

// Multiplayer: the same cut from a "multiplayer" capture, when there is one.
export const MULTIPLAYER_SECONDS = 14;
export const multiplayerClip = (c: Capture): ClipWindow => {
  const go = markerTime(c, 'go') ?? c.perf.raceStartSec ?? 0;
  return {...clamp(c, go - 2, MULTIPLAYER_SECONDS), caption: 'Online: two browsers in one race, through a relay.'};
};

export const CARD_SECONDS = {title: 5, grandPrix: 3, placeholder: 8, closing: 7};
export const FADE_FRAMES = 12;
