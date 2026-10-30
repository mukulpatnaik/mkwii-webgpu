import React from 'react';
import {Capture} from './captures';
import {PlaceholderCard} from './Cards';
import {Clip} from './Clip';
import {SegmentProps} from './Boot';
import {CARD_SECONDS, frames, gameplayClip} from './timeline';

export const gameplayFrames = (c: Capture | null) =>
  c ? frames(gameplayClip(c).length) : frames(CARD_SECONDS.placeholder);

// The countdown and the first stretch of a Grand Prix race, with the page's own fps readings.
export const Gameplay: React.FC<SegmentProps> = ({capture}) => {
  if (!capture) return <PlaceholderCard durationInFrames={frames(CARD_SECONDS.placeholder)} title="Gameplay" capture="race" />;
  return <Clip capture={capture} window={gameplayClip(capture)} fps />;
};
