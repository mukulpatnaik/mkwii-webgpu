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

// Gameplay: the countdown and the first corners of a race. From the "gp" capture (a 50cc Grand
// Prix race on Luigi Circuit whose player kart is driven by kart-bot.js on a fake gamepad), else the
// "timetrial" capture (a Time Trial whose player kart is driven by the disc's staff ghost's
// recorded inputs), else the scripted 50cc Grand Prix drive ("race"). The first two have no driver
// mark for GO: GO shows a fixed time after the course is loaded (the game's `[web-warm] course
// file` line, `race-loaded`), after the flyover in a Grand Prix. That time depends on the machine:
// the HUD timer, which starts at GO, puts it 21.7 s after race-loaded on Linux and 21.4 s on the
// Mac (Portal, Apple Silicon).
export const GAMEPLAY_SECONDS = 8;
const GP_GO_BY_PLATFORM = {linux: 21.7, darwin: 21.4};
const TIMETRIAL_GO = 8.5;
export const gameplayClip = (c: Capture): ClipWindow => {
  if (c.name === 'gp') {
    const go = (markerTime(c, 'race-loaded') ?? markerTime(c, 'ok') ?? 0) + GP_GO_BY_PLATFORM[c.meta.platform ?? 'linux'];
    return {...clamp(c, go - 1.5, GAMEPLAY_SECONDS), caption: 'Grand Prix, 12 karts. A small bot is at the controller.'};
  }
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
// accelerate at the go mark, which comes after the countdown's GO by about 2.5 s on Linux and 3.6 s
// on the Mac (the HUD timer). The race clip starts 2.1 s after GO on both.
const MULTIPLAYER_GO_BEFORE_MARK = {linux: 2.5, darwin: 3.6};
export const multiplayerClips = (a: Capture): ClipWindow[] => {
  const lobby = markerTime(a, 'lobby') ?? 0;
  const go = markerTime(a, 'go') ?? a.perf.raceStartSec ?? lobby + 90;
  const raceFrom = go - MULTIPLAYER_GO_BEFORE_MARK[a.meta.platform ?? 'linux'] + 2.1;
  return [
    {...clamp(a, lobby + 0.6, 2.5), caption: 'Two browsers meet in a room through the relay.'},
    {...clamp(a, raceFrom, 6), caption: `One race, two ${browserName(a)} windows.`},
  ];
};

export const CARD_SECONDS = {title: 2.5, placeholder: 4, closing: 3.5};
export const FADE_FRAMES = 12;
