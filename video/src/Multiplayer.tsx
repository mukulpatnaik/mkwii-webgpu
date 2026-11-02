import React from 'react';
import {AbsoluteFill, OffthreadVideo, Series} from 'remotion';
import {Capture} from './captures';
import {Caption, Fade, PlaceholderCard} from './Cards';
import {FpsOverlay} from './FpsOverlay';
import {theme} from './theme';
import {CARD_SECONDS, ClipWindow, frames, multiplayerClips} from './timeline';

export type MultiplayerProps = {a: Capture | null; b: Capture | null};

export const multiplayerFrames = (p: MultiplayerProps) =>
  p.a && p.b ? multiplayerClips(p.a).reduce((n, w) => n + frames(w.length), 0) : frames(CARD_SECONDS.placeholder);

// One window of the two recordings, side by side; each half carries its own fps reading. Each window keeps its own shape (taller
// than half the frame on most screens), and the two meet in the middle with a small gap, so what
// letterboxing there is goes to the frame's outer edges.
const GAP = 16;
const Pair: React.FC<{a: Capture; b: Capture; window: ClipWindow}> = ({a, b, window}) => {
  const length = frames(window.length);
  return (
    <Fade durationInFrames={length}>
      <AbsoluteFill style={{backgroundColor: theme.letterbox, flexDirection: 'row', justifyContent: 'center', gap: GAP}}>
        {[a, b].map((c, i) => (
          <div
            key={i}
            style={{
              position: 'relative',
              height: '100%',
              aspectRatio: `${c.meta.window.width} / ${c.meta.window.height}`,
              maxWidth: `calc(50% - ${GAP / 2}px)`,
            }}
          >
            <OffthreadVideo
              src={c.src}
              trimBefore={frames(window.from)}
              trimAfter={frames(window.from + window.length)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'contain'}}
            />
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
