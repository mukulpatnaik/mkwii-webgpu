import React from 'react';
import {Capture} from './captures';
import {PlaceholderCard} from './Cards';
import {Clip} from './Clip';
import {SegmentProps} from './Boot';
import {CARD_SECONDS, frames, multiplayerClip} from './timeline';

export const multiplayerFrames = (c: Capture | null) =>
  c ? frames(multiplayerClip(c).length) : frames(CARD_SECONDS.placeholder);

// The slot for online play. Until a "multiplayer" capture exists (two browsers in one race through
// the relay; record it with `tools/video/capture.sh multiplayer <route>` once that route exists),
// a placeholder card holds its place in the demo.
export const Multiplayer: React.FC<SegmentProps> = ({capture}) => {
  if (!capture) {
    return <PlaceholderCard durationInFrames={frames(CARD_SECONDS.placeholder)} title="Online multiplayer" capture="multiplayer" />;
  }
  return <Clip capture={capture} window={multiplayerClip(capture)} fps />;
};
