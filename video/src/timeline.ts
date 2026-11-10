// Where each composition cuts into the captures, in seconds of the capture, from the marks the
// routes leave (tools/browser-test/routes/demo-*.cmds): page, start-clicked, title, ok, go.
import {Capture, markerTime} from './captures';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const frames = (seconds: number) => Math.max(1, Math.round(seconds * FPS));

export type ClipWindow = {from: number; length: number};

const clamp = (c: Capture, from: number, length: number): ClipWindow => {
  const start = Math.max(0, from);
  const end = Math.min(c.meta.durationSec, start + length);
  return {from: start, length: Math.max(0.5, end - start)};
};

// Intro, from the "boot" capture: a second of the title screen (the page boot itself is not shown).
// With the title card and the half second before GO, the race starts about 2.9 s in.
export const bootClips = (c: Capture): ClipWindow[] => {
  const start = markerTime(c, 'start-clicked') ?? (markerTime(c, 'goto') ?? 0) + 6;
  // The title screen follows the game's title-scene console line by about a second.
  const title = (markerTime(c, 'title-loaded') ?? start + 15) + 1.0;
  return [clamp(c, title, 1)];
};

// Gameplay: the countdown and the first corners of each race, one clip per race capture: "gp" (a
// 50cc Grand Prix race on Luigi Circuit whose player kart is driven by kart-bot.js on a fake
// gamepad), then the VS races the bot drives on other courses ("coconut-mall", "mushroom-gorge");
// without gp, the "timetrial" capture (a Time Trial whose player kart is driven by the disc's
// staff ghost's recorded inputs), else the scripted 50cc Grand Prix drive ("race"). GO is the
// bot's own `[bot] go` line (`bot-go`, the first racing frame). Captures from before the bot
// logged it have no mark for GO: it shows a fixed time after the course is loaded (the game's
// `[web-warm] course file` line, `race-loaded`), after the flyover in a Grand Prix. That time
// depends on the machine: the HUD timer, which starts at GO, puts it 21.7 s after race-loaded on
// Linux and 21.4 s on the Mac (Portal, Apple Silicon).
export const GAMEPLAY_SECONDS = 3;
const GAMEPLAY_BEFORE_GO = 0.5;
// The VS races are shown from the middle of the lap rather than the start: seconds after GO and
// the clip's length. Coconut Mall: the jump over the fountain and the shops beyond it; Mushroom
// Gorge: bouncing across the mushrooms in the cave.
const VS_CLIPS: Record<string, {afterGo: number; length: number}> = {
  'coconut-mall': {afterGo: 30, length: 4},
  'mushroom-gorge': {afterGo: 30, length: 4},
};
const GP_GO_BY_PLATFORM = {linux: 21.7, darwin: 21.4};
const TIMETRIAL_GO = 8.5;
export const gameplayClip = (c: Capture): ClipWindow => {
  const botGo = markerTime(c, 'bot-go');
  const vs = VS_CLIPS[c.name];
  if (botGo !== null && vs) return clamp(c, botGo + vs.afterGo, vs.length);
  if (botGo !== null) return clamp(c, botGo - GAMEPLAY_BEFORE_GO, GAMEPLAY_SECONDS);
  if (c.name === 'gp') {
    const go = (markerTime(c, 'race-loaded') ?? markerTime(c, 'ok') ?? 0) + GP_GO_BY_PLATFORM[c.meta.platform ?? 'linux'];
    return clamp(c, go - GAMEPLAY_BEFORE_GO, GAMEPLAY_SECONDS);
  }
  if (c.name === 'timetrial') {
    const go = (markerTime(c, 'race-loaded') ?? markerTime(c, 'ok') ?? 0) + TIMETRIAL_GO;
    return clamp(c, go - 2, GAMEPLAY_SECONDS);
  }
  const go = markerTime(c, 'go') ?? c.perf.raceStartSec ?? 0;
  return clamp(c, go - 2.5, GAMEPLAY_SECONDS);
};

// Multiplayer: two clients of one race through the relay, recorded side by side: the lobby with
// both names, the game's Worldwide VS search finding the other client, then the start of the race.
// The search clip ends on "Your opponents have been chosen!", which shows until about 0.8 s before
// the race-preparation scene is created (`matched`, the `[room-launch] create section=58` line),
// and starts 6 s before that, on the spinning globe, before the zoom to the player's Mii. Cut by client A's marks (both logs carry the same
// marks). Both names are in the roster about half a second after the lobby mark. GO is the bot's
// `bot-go` line when the bot drove; before that, the drivers' go mark, which comes after the
// countdown's GO by about 2.5 s on Linux and 3.6 s on the Mac (the HUD timer). The race clip
// starts 2.1 s after GO on both.
const MULTIPLAYER_GO_BEFORE_MARK = {linux: 2.5, darwin: 3.6};
export const multiplayerClips = (a: Capture): ClipWindow[] => {
  const lobby = markerTime(a, 'lobby') ?? 0;
  const matched = markerTime(a, 'matched');
  const botGo = markerTime(a, 'bot-go');
  const go = botGo ?? (markerTime(a, 'go') ?? a.perf.raceStartSec ?? lobby + 90) - MULTIPLAYER_GO_BEFORE_MARK[a.meta.platform ?? 'linux'];
  const raceFrom = go + 2.1;
  return [
    clamp(a, lobby + 0.6, 2.5),
    ...(matched === null ? [] : [clamp(a, matched - 6.8, 6)]),
    clamp(a, raceFrom, 6),
  ];
};

export const CARD_SECONDS = {title: 1.5, placeholder: 4, closing: 3.5};
export const FADE_FRAMES = 12;
