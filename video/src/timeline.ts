// Where each composition cuts into the captures, in seconds of the capture, from the marks the
// routes leave (tools/browser-test/routes/demo-*.cmds): page, start-clicked, title, ok, go.
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

// Intro, from the "boot" capture: the title screen (the page boot itself is not shown).
export const bootClips = (c: Capture): ClipWindow[] => {
  const start = markerTime(c, 'start-clicked') ?? (markerTime(c, 'goto') ?? 0) + 6;
  // The title screen follows the game's title-scene console line by about a second.
  const title = (markerTime(c, 'title-loaded') ?? start + 15) + 1.0;
  return [{...clamp(c, title, 3), caption: `The title screen, in a ${browserName(c)} tab.`}];
};

// Gameplay: the countdown and the first corners of a race. From the "timetrial" capture (a Time
// Trial on Luigi Circuit whose player kart is driven by the disc's staff ghost's recorded inputs),
// or the scripted 50cc Grand Prix drive ("race") when there is none. The Time Trial has no driver
// mark for GO: GO shows about TIMETRIAL_GO seconds after the course is loaded (the game's
// `[web-warm] course file` line, `race-loaded`).
export const GAMEPLAY_SECONDS = 8;
const TIMETRIAL_GO = 8.5;
export const gameplayClip = (c: Capture): ClipWindow => {
  if (c.name === 'timetrial') {
    const go = (markerTime(c, 'race-loaded') ?? markerTime(c, 'ok') ?? 0) + TIMETRIAL_GO;
    return {...clamp(c, go - 2, GAMEPLAY_SECONDS), caption: "Time Trial, Luigi Circuit, on the staff ghost's recorded inputs."};
  }
  const go = markerTime(c, 'go') ?? c.perf.raceStartSec ?? 0;
  return {...clamp(c, go - 2.5, GAMEPLAY_SECONDS), caption: 'Grand Prix, 50cc, 12 karts, keyboard and mouse.'};
};

// Multiplayer: two clients of one race through the relay, recorded side by side: the lobby with
// both names, then the start of the race. Cut by client A's marks (both logs carry the same
// marks). Both names are in the roster about half a second after the lobby mark; the drivers press
// accelerate at the go mark, about 2.5 s after the countdown's GO.
export const multiplayerClips = (a: Capture): ClipWindow[] => {
  const lobby = markerTime(a, 'lobby') ?? 0;
  const go = markerTime(a, 'go') ?? a.perf.raceStartSec ?? lobby + 90;
  return [
    {...clamp(a, lobby + 0.6, 2.5), caption: 'Two browsers meet in a room through the relay.'},
    {...clamp(a, go - 0.4, 6), caption: `One race, two ${browserName(a)} windows.`},
  ];
};

export const CARD_SECONDS = {title: 2.5, placeholder: 4, closing: 3.5};
export const FADE_FRAMES = 12;
