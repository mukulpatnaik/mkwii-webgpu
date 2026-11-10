import React from 'react';
import {AbsoluteFill, Series} from 'remotion';
import {Capture} from './captures';
import {Fade, PlaceholderCard} from './Cards';
import {WindowVideo} from './Clip';
import {theme} from './theme';
import {CARD_SECONDS, ClipWindow, frames, HEIGHT, multiplayerClips, WIDTH} from './timeline';

export type MultiplayerProps = {a: Capture | null; b: Capture | null};

export const multiplayerFrames = (p: MultiplayerProps) =>
  p.a && p.b ? multiplayerClips(p.a).reduce((n, w) => n + frames(w.length), 0) : frames(CARD_SECONDS.placeholder);

// One window of the two recordings, side by side. Each window keeps its own shape (taller than
// half the frame on most screens), and the two meet in the middle with a small gap, so what
// letterboxing there is goes to the frame's outer edges.
const GAP = 16;
const Pair: React.FC<{a: Capture; b: Capture; window: ClipWindow}> = ({a, b, window}) => {
  const length = frames(window.length);
  const half = (WIDTH - GAP) / 2;
  return (
    <Fade durationInFrames={length}>
      <AbsoluteFill style={{backgroundColor: theme.letterbox, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: GAP}}>
        {[a, b].map((c, i) => (
          <WindowVideo key={i} capture={c} window={window} maxWidth={half} maxHeight={HEIGHT} />
        ))}
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
