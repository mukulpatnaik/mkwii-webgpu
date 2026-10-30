import React from 'react';
import {AbsoluteFill, Series} from 'remotion';
import {Capture} from './captures';
import {ClosingCard, TextCard, TitleCard} from './Cards';
import {Boot, bootFrames} from './Boot';
import {Gameplay, gameplayFrames} from './Gameplay';
import {Multiplayer, multiplayerFrames} from './Multiplayer';
import {theme} from './theme';
import {CARD_SECONDS, frames} from './timeline';

export type MainProps = {boot: Capture | null; race: Capture | null; multiplayer: Capture | null};

// The demo, in order; each entry's length in frames, so Root can report the total.
export const mainSegments = (p: MainProps) => [
  {id: 'title', frames: frames(CARD_SECONDS.title)},
  {id: 'boot', frames: bootFrames(p.boot)},
  {id: 'grand-prix', frames: frames(CARD_SECONDS.grandPrix)},
  {id: 'gameplay', frames: gameplayFrames(p.race)},
  {id: 'multiplayer', frames: multiplayerFrames(p.multiplayer)},
  {id: 'closing', frames: frames(CARD_SECONDS.closing)},
];
export const mainFrames = (p: MainProps) => mainSegments(p).reduce((n, s) => n + s.frames, 0);

export const Main: React.FC<MainProps> = (props) => {
  const seg = Object.fromEntries(mainSegments(props).map((s) => [s.id, s.frames]));
  return (
    <AbsoluteFill style={{backgroundColor: theme.bg}}>
      <Series>
        <Series.Sequence durationInFrames={seg.title}>
          <TitleCard durationInFrames={seg.title} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.boot}>
          <Boot capture={props.boot} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg['grand-prix']}>
          <TextCard durationInFrames={seg['grand-prix']} lines={['A Grand Prix.']} note="Keyboard and mouse, 60 frames per second." />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.gameplay}>
          <Gameplay capture={props.race} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.multiplayer}>
          <Multiplayer capture={props.multiplayer} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={seg.closing}>
          <ClosingCard durationInFrames={seg.closing} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
