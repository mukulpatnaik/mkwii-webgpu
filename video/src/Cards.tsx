import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from './theme';
import {FADE_FRAMES} from './timeline';

// Fades its content in at the start and out at the end of the enclosing sequence.
export const Fade: React.FC<{children: React.ReactNode; durationInFrames: number}> = ({children, durationInFrames}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, Math.max(FADE_FRAMES + 1, durationInFrames - FADE_FRAMES), durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return <AbsoluteFill style={{opacity, backgroundColor: theme.bg}}>{children}</AbsoluteFill>;
};

const cardStyle: React.CSSProperties = {
  backgroundColor: theme.bg,
  color: theme.fg,
  fontFamily: theme.fontFamily,
  justifyContent: 'center',
  alignItems: 'center',
  padding: 160,
  textAlign: 'center',
};

// Lines appear one after another, a few frames apart.
const Lines: React.FC<{lines: string[]; size: number; weight?: number; color?: string; gap?: number}> = ({
  lines, size, weight = 600, color = theme.fg, gap = 0.25,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: size * gap}}>
      {lines.map((line, i) => {
        const at = FADE_FRAMES + i * Math.round(fps * 0.35);
        const opacity = interpolate(frame, [at, at + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const y = interpolate(frame, [at, at + 14], [10, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return (
          <div key={line} style={{fontSize: size, fontWeight: weight, color, opacity, transform: `translateY(${y}px)`, lineHeight: 1.15}}>
            {line}
          </div>
        );
      })}
    </div>
  );
};

export const TitleCard: React.FC<{durationInFrames: number}> = ({durationInFrames}) => (
  <Fade durationInFrames={durationInFrames}>
    <AbsoluteFill style={cardStyle}>
      <Lines lines={['Mario Kart Wii.', 'In Chrome.', 'Not an emulator.']} size={112} />
    </AbsoluteFill>
  </Fade>
);

export const TextCard: React.FC<{durationInFrames: number; lines: string[]; note?: string}> = ({durationInFrames, lines, note}) => (
  <Fade durationInFrames={durationInFrames}>
    <AbsoluteFill style={cardStyle}>
      <Lines lines={lines} size={72} />
      {note ? <div style={{marginTop: 48, fontSize: 32, fontWeight: 400, color: theme.muted}}>{note}</div> : null}
    </AbsoluteFill>
  </Fade>
);

export const ClosingCard: React.FC<{durationInFrames: number}> = ({durationInFrames}) => (
  <Fade durationInFrames={durationInFrames}>
    <AbsoluteFill style={cardStyle}>
      <Lines lines={['mukulpatnaik/mkwii-webgpu', 'Build it from your own disc.']} size={80} />
      <div style={{marginTop: 56, fontSize: 36, fontWeight: 400, color: theme.muted}}>
        github.com/mukulpatnaik/mkwii-webgpu
      </div>
    </AbsoluteFill>
  </Fade>
);

// Stands in for a capture that is not there (captures are never committed) or not yet made.
export const PlaceholderCard: React.FC<{durationInFrames: number; title: string; capture: string}> = ({durationInFrames, title, capture}) => (
  <Fade durationInFrames={durationInFrames}>
    <AbsoluteFill style={cardStyle}>
      <div style={{position: 'absolute', inset: 80, border: `6px dashed ${theme.muted}`, borderRadius: 12}} />
      <Lines lines={[title]} size={80} />
      <div style={{marginTop: 40, fontSize: 32, fontWeight: 400, color: theme.muted, lineHeight: 1.5}}>
        footage slot: video/public/captures/{capture}/
        <br />
        tools/video/capture.sh {capture}
      </div>
    </AbsoluteFill>
  </Fade>
);

// A short line of text over footage, bottom right.
export const Caption: React.FC<{text: string}> = ({text}) => (
  <div
    style={{
      position: 'absolute',
      right: 48,
      bottom: 40,
      maxWidth: 1100,
      fontFamily: theme.fontFamily,
      fontSize: 30,
      fontWeight: 400,
      color: theme.fg,
      backgroundColor: 'rgba(11, 12, 16, 0.78)',
      padding: '14px 22px',
      borderRadius: 8,
      textAlign: 'right',
      lineHeight: 1.3,
    }}
  >
    {text}
  </div>
);
