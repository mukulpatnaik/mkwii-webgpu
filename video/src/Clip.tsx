import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import {Capture} from './captures';
import {Fade} from './Cards';
import {ClipWindow, frames, HEIGHT, WIDTH} from './timeline';
import {theme} from './theme';

// macOS rounds every window's corners (about 18 pt on macOS 26), and the Mac capture is a crop of
// the whole screen, so a recorded window's corners hold a little desktop. The compositions mask
// each Darwin capture with the same corner, a touch larger, in the letterbox colour. Linux
// captures are x11grab of the window itself and are square.
const MAC_CORNER_PT = 20;

// The size at which a capture's window fits a box, and the corner mask to draw it with.
export const windowBox = (c: Capture, maxWidth: number, maxHeight: number) => {
  const {width, height} = c.meta.window;
  const fit = Math.min(maxWidth / width, maxHeight / height);
  const radius = c.meta.platform === 'darwin' ? MAC_CORNER_PT * (c.meta.scale ?? 1) * fit : 0;
  return {width: width * fit, height: height * fit, radius};
};

// A capture's window in a box, letterboxed, playing one window of its recording.
export const WindowVideo: React.FC<{capture: Capture; window: ClipWindow; maxWidth: number; maxHeight: number}> = ({
  capture, window, maxWidth, maxHeight,
}) => {
  const box = windowBox(capture, maxWidth, maxHeight);
  return (
    <div style={{width: box.width, height: box.height, borderRadius: box.radius, overflow: 'hidden', flex: 'none'}}>
      <OffthreadVideo
        src={capture.src}
        trimBefore={frames(window.from)}
        trimAfter={frames(window.from + window.length)}
        muted
        style={{width: '100%', height: '100%', display: 'block'}}
      />
    </div>
  );
};

// A window of a capture, letterboxed into the frame.
export const Clip: React.FC<{capture: Capture; window: ClipWindow}> = ({capture, window}) => {
  const length = frames(window.length);
  return (
    <Fade durationInFrames={length}>
      <AbsoluteFill style={{backgroundColor: theme.letterbox, justifyContent: 'center', alignItems: 'center'}}>
        <WindowVideo capture={capture} window={window} maxWidth={WIDTH} maxHeight={HEIGHT} />
      </AbsoluteFill>
    </Fade>
  );
};
