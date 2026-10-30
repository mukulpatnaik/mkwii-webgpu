import React from 'react';
import {AbsoluteFill, OffthreadVideo, Series, useCurrentFrame, useVideoConfig} from 'remotion';
import {Capture} from './captures';
import {Caption, Fade, PlaceholderCard} from './Cards';
import {FpsOverlay} from './FpsOverlay';
import {theme} from './theme';
import {CARD_SECONDS, ClipWindow, frames, multiplayerClips} from './timeline';

export type MultiplayerProps = {a: Capture | null; b: Capture | null};

export const multiplayerFrames = (p: MultiplayerProps) =>
  p.a && p.b ? multiplayerClips(p.a).reduce((n, w) => n + frames(w.length), 0) : frames(CARD_SECONDS.placeholder);

// The latest room/relay console line of a client at this moment of the clip, as printed.
const EventLine: React.FC<{capture: Capture; clipStartSec: number}> = ({capture, clipStartSec}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = clipStartSec + frame / fps;
  let text = '';
  for (const e of capture.perf.events ?? []) {
    if (e.t <= t) text = e.text;
    else break;
  }
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 24,
        right: 24,
        top: 24,
        fontFamily: theme.fontFamily,
        fontSize: 22,
        fontWeight: 400,
        color: theme.muted,
        backgroundColor: 'rgba(11, 12, 16, 0.78)',
        padding: '8px 14px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
};

// One window of the two recordings, side by side; each half carries its own fps reading and the
// console line that shows where it stands with the room.
const Pair: React.FC<{a: Capture; b: Capture; window: ClipWindow}> = ({a, b, window}) => {
  const length = frames(window.length);
  return (
    <Fade durationInFrames={length}>
      <AbsoluteFill style={{backgroundColor: theme.bg, flexDirection: 'row'}}>
        {[a, b].map((c) => (
          <div key={c.name} style={{position: 'relative', width: '50%', height: '100%'}}>
            <OffthreadVideo
              src={c.src}
              trimBefore={frames(window.from)}
              trimAfter={frames(window.from + window.length)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'contain'}}
            />
            <EventLine capture={c} clipStartSec={window.from} />
            <FpsOverlay perf={c.perf} clipStartSec={window.from} compact />
          </div>
        ))}
        {window.caption ? <Caption text={window.caption} /> : null}
      </AbsoluteFill>
    </Fade>
  );
};

// The online-play segment. Record it with `tools/video/capture.sh multiplayer` (two clients in one
// race through the relay); until the captures exist a placeholder card holds its place.
export const Multiplayer: React.FC<MultiplayerProps> = ({a, b}) => {
  if (!a || !b) {
    return <PlaceholderCard durationInFrames={frames(CARD_SECONDS.placeholder)} title="Online multiplayer" capture="multiplayer" />;
  }
  return (
    <Series>
      {multiplayerClips(a).map((w, i) => (
        <Series.Sequence key={i} durationInFrames={frames(w.length)}>
          <Pair a={a} b={b} window={w} />
        </Series.Sequence>
      ))}
    </Series>
  );
};
