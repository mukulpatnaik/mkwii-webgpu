import React from 'react';
import {AbsoluteFill, Series} from 'remotion';
import {Capture} from './captures';
import {ClosingCard, TitleCard} from './Cards';
import {Boot, bootFrames} from './Boot';
import {Gameplay, gameplayFrames} from './Gameplay';
import {Multiplayer, multiplayerFrames, MultiplayerProps} from './Multiplayer';
import {theme} from './theme';
import {CARD_SECONDS, frames} from './timeline';

export type MainProps = {boot: Capture | null; gameplay: Capture | null; multiplayer: MultiplayerProps};

// The demo, in order (title, intro, race, online play, closing); each entry's length in frames.
export const mainSegments = (p: MainProps) => [
  {id: 'title', frames: frames(CARD_SECONDS.title)},
  {id: 'intro', frames: bootFrames(p.boot)},
  {id: 'gameplay', frames: gameplayFrames(p.gameplay)},
  {id: 'multiplayer', frames: multiplayerFrames(p.multiplayer)},
  {id: 'closing', frames: frames(CARD_SECONDS.closing)},
];
export const mainFrames = (p: MainProps) => mainSegments(p).reduce((n, s) => n + s.frames, 0);

export const Main: React.FC<MainProps> = (props) => {
  const seg = Object.fromEntries(mainSegments(props).map((s) => [s.id, s.frames]));
  return (
    <AbsoluteFill style={{backgroundColor: theme.letterbox}}>
      <Series>
        <Series.Sequence durationInFrames={seg.title}>
          <TitleCard durationInFrames={seg.title} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.intro}>
          <Boot capture={props.boot} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.gameplay}>
          <Gameplay capture={props.gameplay} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.multiplayer}>
          <Multiplayer a={props.multiplayer.a} b={props.multiplayer.b} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.closing}>
          <ClosingCard durationInFrames={seg.closing} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
