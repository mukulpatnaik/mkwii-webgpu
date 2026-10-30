import React from 'react';
import {Series} from 'remotion';
import {Capture} from './captures';
import {PlaceholderCard} from './Cards';
import {Clip} from './Clip';
import {bootClips, CARD_SECONDS, frames} from './timeline';

export type SegmentProps = {capture: Capture | null};

export const bootFrames = (c: Capture | null) =>
  c ? bootClips(c).reduce((n, w) => n + frames(w.length), 0) : frames(CARD_SECONDS.placeholder);

// The intro: the title screen and the opening movie, from the boot capture.
export const Boot: React.FC<SegmentProps> = ({capture}) => {
  if (!capture) return <PlaceholderCard durationInFrames={frames(CARD_SECONDS.placeholder)} title="Intro" capture="boot" />;
  return (
    <Series>
      {bootClips(capture).map((w, i) => (
        <Series.Sequence key={i} durationInFrames={frames(w.length)}>
          <Clip capture={capture} window={w} />
        </Series.Sequence>
      ))}
    </Series>
  );
};
