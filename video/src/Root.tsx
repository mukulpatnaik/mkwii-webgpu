import React from 'react';
import {Composition} from 'remotion';
import {Boot, bootFrames, SegmentProps} from './Boot';
import {Capture, CaptureName, loadCapture} from './captures';
import {Gameplay, gameplayFrames} from './Gameplay';
import {Main, mainFrames, MainProps} from './Main';
import {Multiplayer, multiplayerFrames, MultiplayerProps} from './Multiplayer';
import {FPS, HEIGHT, WIDTH} from './timeline';

// Every composition reads its capture(s) from public/captures/ when it is opened or rendered, and
// takes its length from the marks in them; with no capture it is a placeholder card.
const segment = (name: CaptureName, length: (c: Capture | null) => number) => ({
  defaultProps: {capture: null} as SegmentProps,
  calculateMetadata: async () => {
    const capture = await loadCapture(name);
    return {props: {capture}, durationInFrames: length(capture)};
  },
});

export const Root: React.FC = () => (
  <>
    <Composition
      id="Main"
      component={Main}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 60}
      defaultProps={{boot: null, race: null, multiplayer: {a: null, b: null}} as MainProps}
      calculateMetadata={async () => {
        const [boot, race, a, b] = await Promise.all([
          loadCapture('boot'), loadCapture('race'), loadCapture('multiplayer/a'), loadCapture('multiplayer/b'),
        ]);
        const props: MainProps = {boot, race, multiplayer: {a, b}};
        return {props, durationInFrames: mainFrames(props)};
      }}
    />
    <Composition id="Boot" component={Boot} fps={FPS} width={WIDTH} height={HEIGHT} durationInFrames={FPS * 10} {...segment('boot', bootFrames)} />
    <Composition id="Gameplay" component={Gameplay} fps={FPS} width={WIDTH} height={HEIGHT} durationInFrames={FPS * 10} {...segment('race', gameplayFrames)} />
    <Composition
      id="Multiplayer"
      component={Multiplayer}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      defaultProps={{a: null, b: null} as MultiplayerProps}
      calculateMetadata={async () => {
        const [a, b] = await Promise.all([loadCapture('multiplayer/a'), loadCapture('multiplayer/b')]);
        return {props: {a, b}, durationInFrames: multiplayerFrames({a, b})};
      }}
    />
  </>
);
