import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {bluePill, theme, yellowButton} from './theme';
import {FADE_FRAMES} from './timeline';

// Fades its content in at the start and out at the end of the enclosing sequence.
export const Fade: React.FC<{children: React.ReactNode; durationInFrames: number; background?: string}> = ({
  children, durationInFrames, background = theme.letterbox,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, Math.max(FADE_FRAMES + 1, durationInFrames - FADE_FRAMES), durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return <AbsoluteFill style={{opacity, backgroundColor: background}}>{children}</AbsoluteFill>;
};

// The Wii Menu ground: grey with faint horizontal lines.
const ground: React.CSSProperties = {
  backgroundColor: theme.ground,
  backgroundImage: `repeating-linear-gradient(180deg, ${theme.groundLine} 0 2px, transparent 2px 14px)`,
  color: theme.text,
  fontFamily: theme.fontFamily,
  justifyContent: 'center',
  alignItems: 'center',
};

// A channel-like white tile that settles in from slightly smaller, then holds.
const Tile: React.FC<{children: React.ReactNode; width?: number}> = ({children, width = 1240}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 18], [0.96, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div
      style={{
        width,
        padding: '72px 80px',
        boxSizing: 'border-box',
        backgroundColor: theme.tile,
        border: `1px solid ${theme.tileLine}`,
        borderRadius: 28,
        boxShadow: '0 0 0 6px #ffffff, 0 4px 18px rgba(0, 0, 0, 0.18)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 36,
        textAlign: 'center',
        transform: `scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
};

// Appears a beat after the tile, rising a little.
const Reveal: React.FC<{children: React.ReactNode; at: number}> = ({children, at}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at, at + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const y = interpolate(frame, [at, at + 14], [10, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{opacity, transform: `translateY(${y}px)`}}>{children}</div>;
};

const Pill: React.FC<{children: React.ReactNode; kind: 'blue' | 'yellow'; size?: number}> = ({children, kind, size = 44}) => (
  <div
    style={{
      ...(kind === 'blue' ? bluePill : yellowButton),
      display: 'inline-block',
      fontSize: size,
      fontWeight: 900,
      padding: `${Math.round(size * 0.35)}px ${Math.round(size * 1.1)}px`,
      lineHeight: 1.1,
    }}
  >
    {children}
  </div>
);

export const TitleCard: React.FC<{durationInFrames: number}> = ({durationInFrames}) => {
  const {fps} = useVideoConfig();
  // A short card (the race should start within three seconds): both lines come in with the fade.
  const beat = Math.round(fps * 0.2);
  return (
    <Fade durationInFrames={durationInFrames} background={theme.ground}>
      <AbsoluteFill style={ground}>
        <Tile>
          <Reveal at={4}>
            <div style={{fontSize: 128, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.01em'}}>Mario Kart Wii.</div>
          </Reveal>
          <Reveal at={4 + beat}>
            <Pill kind="blue">In the browser via WebGPU.</Pill>
          </Reveal>
        </Tile>
      </AbsoluteFill>
    </Fade>
  );
};

// The site's address as the page's big blue pill: it pops in, a sheen crosses it once, and the
// Wii Menu's light-blue hover ring breathes around it.
const SiteLink: React.FC<{at: number}> = ({at}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame - at;
  const pop = spring({frame: t, fps, config: {damping: 11, stiffness: 150, mass: 0.7}});
  const opacity = interpolate(t, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const ring = 0.5 + 0.5 * Math.sin((Math.max(0, t) / fps) * Math.PI * 2 * 0.9);
  const sheen = interpolate(t, [fps * 0.45, fps * 1.15], [-30, 130], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div
      style={{
        ...bluePill,
        position: 'relative',
        overflow: 'hidden',
        opacity,
        transform: `scale(${0.8 + 0.2 * pop})`,
        border: '4px solid #1b63a8',
        padding: '34px 96px 38px',
        fontSize: 128,
        fontWeight: 900,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        textShadow: '0 3px 2px rgba(0, 0, 0, 0.28)',
        boxShadow: [
          'inset 0 4px 0 rgba(255, 255, 255, 0.45)',
          `0 0 0 ${8 + 5 * ring}px rgba(52, 190, 237, ${0.3 + 0.3 * ring})`,
          `0 0 ${36 + 24 * ring}px rgba(52, 190, 237, ${0.35 + 0.3 * ring})`,
          '0 10px 22px rgba(0, 0, 0, 0.22)',
        ].join(', '),
      }}
    >
      mkwii.online
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${sheen}%`,
          width: '22%',
          transform: 'skewX(-20deg)',
          background: 'linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0))',
        }}
      />
    </div>
  );
};

export const ClosingCard: React.FC<{durationInFrames: number}> = ({durationInFrames}) => {
  const {fps} = useVideoConfig();
  const beat = Math.round(fps * 0.3);
  return (
    <Fade durationInFrames={durationInFrames} background={theme.ground}>
      <AbsoluteFill style={ground}>
        {/* The address sits at the centre of the frame; the source line hangs under the tile. */}
        <div style={{position: 'relative'}}>
          <Tile width={1320}>
            <div style={{padding: '34px 0'}}>
              <SiteLink at={FADE_FRAMES} />
            </div>
          </Tile>
          <div style={{position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 44, textAlign: 'center'}}>
            <Reveal at={FADE_FRAMES + 2 * beat}>
              <div style={{fontSize: 34, fontWeight: 700, color: theme.muted}}>github.com/mukulpatnaik/mkwii-webgpu</div>
            </Reveal>
          </div>
        </div>
      </AbsoluteFill>
    </Fade>
  );
};

// Stands in for a capture that is not there (captures are never committed) or not yet made.
export const PlaceholderCard: React.FC<{durationInFrames: number; title: string; capture: string}> = ({durationInFrames, title, capture}) => (
  <Fade durationInFrames={durationInFrames} background={theme.ground}>
    <AbsoluteFill style={ground}>
      <Tile>
        <div style={{fontSize: 80, fontWeight: 900}}>{title}</div>
        <div style={{fontSize: 32, fontWeight: 700, color: theme.muted, lineHeight: 1.5}}>
          footage slot: video/public/captures/{capture}/
          <br />
          tools/video/capture.sh {capture}
        </div>
      </Tile>
    </AbsoluteFill>
  </Fade>
);
