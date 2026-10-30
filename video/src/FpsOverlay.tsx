import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Perf} from './captures';
import {theme} from './theme';

// The frame rate the page itself measured: every three seconds it prints `[web-perf] fps=…` to
// the console, and perf.json puts those lines on the capture's clock. The overlay shows the most
// recent line for the moment of the clip being played; no number here is made up.
export const FpsOverlay: React.FC<{perf: Perf; clipStartSec: number}> = ({perf, clipStartSec}) => {
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
        left: 48,
        bottom: 40,
        fontFamily: theme.fontFamily,
        color: theme.fg,
        backgroundColor: 'rgba(11, 12, 16, 0.78)',
        padding: '14px 22px',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
      }}
    >
      <span style={{fontSize: 56, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 110}}>
        {sample ? sample.fps.toFixed(1) : '—'}
      </span>
      <span style={{fontSize: 28, fontWeight: 400, color: theme.muted}}>fps, measured by the page (3 s average)</span>
    </div>
  );
};
