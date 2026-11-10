import React from 'react';
import {Series} from 'remotion';
import {Capture} from './captures';
import {PlaceholderCard} from './Cards';
import {Clip} from './Clip';
import {CARD_SECONDS, frames, gameplayClip} from './timeline';

export type GameplayProps = {captures: Capture[]};

export const gameplayFrames = (cs: Capture[]) =>
  cs.length ? cs.reduce((n, c) => n + frames(gameplayClip(c).length), 0) : frames(CARD_SECONDS.placeholder);

// The countdown and the first stretch of each race: the Grand Prix on Luigi Circuit, then the VS
// races on other courses, all driven by the bot (or a Time Trial on the staff ghost's inputs, or
// the scripted Grand Prix drive, when there is no gp capture).
export const Gameplay: React.FC<GameplayProps> = ({captures}) => {
  if (!captures.length) return <PlaceholderCard durationInFrames={frames(CARD_SECONDS.placeholder)} title="Gameplay" capture="gp" />;
  return (
    <Series>
      {captures.map((c) => (
        <Series.Sequence key={c.name} durationInFrames={frames(gameplayClip(c).length)}>
          <Clip capture={c} window={gameplayClip(c)} />
        </Series.Sequence>
      ))}
    </Series>
  );
};
