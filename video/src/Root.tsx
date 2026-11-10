import React from 'react';
import {Composition} from 'remotion';
import {Boot, bootFrames, SegmentProps} from './Boot';
import {Capture, loadCapture} from './captures';
import {Gameplay, gameplayFrames, GameplayProps} from './Gameplay';
import {Main, mainFrames, MainProps} from './Main';
import {Multiplayer, multiplayerFrames, MultiplayerProps} from './Multiplayer';
import {FPS, HEIGHT, WIDTH} from './timeline';

// Every composition reads its capture(s) from public/captures/ when it is opened or rendered, and
// takes its length from the marks in them; with no capture it is a placeholder card.
const segment = (load: () => Promise<Capture | null>, length: (c: Capture | null) => number) => ({
  defaultProps: {capture: null} as SegmentProps,
  calculateMetadata: async () => {
    const capture = await load();
    return {props: {capture}, durationInFrames: length(capture)};
  },
});

// The gameplay segment: the Grand Prix driven by the bot (else the Time Trial on the staff
// ghost's inputs, else the scripted Grand Prix drive), then the bot's VS races on other courses.
const loadGameplay = async (): Promise<Capture[]> => {
  const first = (await loadCapture('gp')) ?? (await loadCapture('timetrial')) ?? (await loadCapture('race'));
  const more = await Promise.all([loadCapture('coconut-mall'), loadCapture('mushroom-gorge')]);
  return [first, ...more].filter((c): c is Capture => c !== null);
};
const gameplaySegment = {
  defaultProps: {captures: []} as GameplayProps,
  calculateMetadata: async () => {
    const captures = await loadGameplay();
    return {props: {captures}, durationInFrames: gameplayFrames(captures)};
  },
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Main"
      component={Main}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 60}
      defaultProps={{boot: null, gameplay: [], multiplayer: {a: null, b: null}} as MainProps}
      calculateMetadata={async () => {
        const [boot, gameplay, a, b] = await Promise.all([
          loadCapture('boot'), loadGameplay(), loadCapture('multiplayer/a'), loadCapture('multiplayer/b'),
        ]);
        const props: MainProps = {boot, gameplay, multiplayer: {a, b}};
        return {props, durationInFrames: mainFrames(props)};
      }}
    />
    <Composition id="Boot" component={Boot} fps={FPS} width={WIDTH} height={HEIGHT} durationInFrames={FPS * 10} {...segment(() => loadCapture('boot'), bootFrames)} />
    <Composition id="Gameplay" component={Gameplay} fps={FPS} width={WIDTH} height={HEIGHT} durationInFrames={FPS * 10} {...gameplaySegment} />
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
