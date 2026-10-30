import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Perf} from './captures';
import {theme} from './theme';

// The frame rate the page itself measured: every three seconds it prints `[web-perf] fps=…` to
// the console, and perf.json puts those lines on the capture's clock. The overlay shows the most
// recent line for the moment of the clip being played; no number here is made up.
export const FpsOverlay: React.FC<{perf: Perf; clipStartSec: number; compact?: boolean}> = ({perf, clipStartSec, compact}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = clipStartSec + frame / fps;
  let sample = null;
  for (const s of perf.samples) {
    if (s.t <= t) sample = s;
    else break;
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: compact ? 24 : 48,
        bottom: compact ? 24 : 40,
        fontFamily: theme.fontFamily,
        color: theme.overlayText,
        backgroundColor: theme.overlayBg,
        padding: compact ? '8px 14px' : '14px 22px',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
      }}
    >
      <span style={{fontSize: compact ? 34 : 56, fontWeight: 900, fontVariantNumeric: 'tabular-nums', minWidth: compact ? 66 : 110}}>
        {sample ? sample.fps.toFixed(1) : '—'}
      </span>
      <span style={{fontSize: compact ? 20 : 28, fontWeight: 700, color: theme.overlayMuted}}>
        {compact ? 'fps, measured by the page' : 'fps, measured by the page (3 s average)'}
      </span>
    </div>
  );
};
