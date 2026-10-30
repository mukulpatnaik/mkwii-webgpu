// Where each composition cuts into the captures, in seconds of the capture, from the marks the
// routes leave (tools/browser-test/routes/demo-*.cmds): page, start-clicked, title, race-ok, go.
import {browserName, Capture, markerTime} from './captures';

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

// Intro, from the "boot" capture: the title screen, then a moment of the opening movie the title
// drops into when nothing is pressed (about 15 s later). The page boot itself is not shown.
export const bootClips = (c: Capture): ClipWindow[] => {
  const start = markerTime(c, 'start-clicked') ?? (markerTime(c, 'goto') ?? 0) + 6;
  // The title screen follows the game's title-scene console line by about a second.
  const title = (markerTime(c, 'title-loaded') ?? start + 15) + 1.0;
  return [
    {...clamp(c, title, 3.5), caption: `A ${browserName(c)} tab. Rendered with WebGPU.`},
    {...clamp(c, title + 16.5, 3), caption: 'The opening movie plays too.'},
  ];
};

// Gameplay: the countdown and the first corners of a race. From the "replay" capture (the disc's
// staff ghost on Luigi Circuit, played back by the game), or the scripted 50cc Grand Prix drive
// ("race") when there is no replay. A replay has no driver mark for GO: the countdown's "3" shows
// about 5.3 s and GO about 8.3 s after the course is loaded (the game's `[web-warm] course file`
// line, `race-loaded`).
export const GAMEPLAY_SECONDS = 13;
export const gameplayClip = (c: Capture): ClipWindow => {
  if (c.name === 'replay') {
    const go = (markerTime(c, 'race-loaded') ?? markerTime(c, 'replay') ?? 0) + 8.3;
    return {...clamp(c, go - 3.5, GAMEPLAY_SECONDS), caption: 'The staff ghost on Luigi Circuit, 1:29.670, replayed by the game.'};
  }
  const go = markerTime(c, 'go') ?? c.perf.raceStartSec ?? 0;
  return {...clamp(c, go - 2.5, GAMEPLAY_SECONDS), caption: 'Grand Prix, 50cc, 12 karts, keyboard and mouse.'};
};

// Multiplayer: two clients of one race through the relay, recorded side by side: the lobby with
// both names, then the countdown and the start. Cut by client A's marks (both logs carry the same
// marks). Both names are in the roster about half a second after the lobby mark; the countdown's
// "3" shows about six seconds before the drivers press accelerate.
export const multiplayerClips = (a: Capture): ClipWindow[] => {
  const lobby = markerTime(a, 'lobby') ?? 0;
  const go = markerTime(a, 'go') ?? a.perf.raceStartSec ?? lobby + 90;
  return [
    {...clamp(a, lobby + 0.6, 3), caption: 'Two browsers meet in a room through the relay.'},
    {...clamp(a, go - 6.5, 7), caption: `One race, two ${browserName(a)} windows.`},
  ];
};

export const CARD_SECONDS = {title: 3, placeholder: 4, closing: 4};
export const FADE_FRAMES = 12;
