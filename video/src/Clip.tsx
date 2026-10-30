import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import {Capture} from './captures';
import {Caption, Fade} from './Cards';
import {FpsOverlay} from './FpsOverlay';
import {ClipWindow, frames} from './timeline';
import {theme} from './theme';

// A window of a capture, letterboxed into the frame, with an optional caption and fps overlay.
export const Clip: React.FC<{capture: Capture; window: ClipWindow; fps?: boolean}> = ({capture, window, fps}) => {
  const length = frames(window.length);
  return (
    <Fade durationInFrames={length}>
      <AbsoluteFill style={{backgroundColor: theme.bg}}>
        <OffthreadVideo
          src={capture.src}
          trimBefore={frames(window.from)}
          trimAfter={frames(window.from + window.length)}
          muted
          style={{width: '100%', height: '100%', objectFit: 'contain'}}
        />
        {fps ? <FpsOverlay perf={capture.perf} clipStartSec={window.from} /> : null}
        {window.caption ? <Caption text={window.caption} /> : null}
      </AbsoluteFill>
    </Fade>
  );
};
