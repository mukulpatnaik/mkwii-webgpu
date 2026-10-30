// The page's Wii Menu look (work/Wiicompiled runtime/src/platform/web/shell.html): a grey ground,
// white rounded tiles, Wii-blue glossy pills, the game's yellow OK button, a rounded typeface.
// Nunito stands in for the page's rounded system stack and comes from Google Fonts at render time.
import {loadFont} from '@remotion/google-fonts/Nunito';

const {fontFamily} = loadFont('normal', {weights: ['700', '800', '900'], subsets: ['latin']});

export const theme = {
  ground: '#e9edf1',
  groundLine: '#dfe4e9',
  tile: '#ffffff',
  tileLine: '#d3d8dd',
  text: '#2b2f33',
  muted: '#5f666d',
  accent: '#2f8fe0',
  // Over footage: the page's own dark overlay colours.
  overlayBg: 'rgba(0, 0, 0, 0.75)',
  overlayText: '#e6edf5',
  overlayMuted: '#c9d3dd',
  // Letterbox around the recorded Chrome window, which has a dark frame.
  letterbox: '#0b0c10',
  fontFamily: `${fontFamily}, Nunito, "Varela Round", ui-rounded, system-ui, sans-serif`,
};

// The page's primary pill (Wii blue, glossy) and its Start button (the game's yellow OK).
export const bluePill: React.CSSProperties = {
  background: 'linear-gradient(#5db0f2, #2f8fe0 48%, #1e74c4 52%, #2a86d6)',
  color: '#ffffff',
  border: '2px solid #1b63a8',
  borderRadius: 999,
  boxShadow: 'inset 0 2px 0 rgba(255, 255, 255, 0.45), 0 3px 8px rgba(0, 0, 0, 0.18)',
  textShadow: '0 1px 1px rgba(0, 0, 0, 0.25)',
};
export const yellowButton: React.CSSProperties = {
  background: 'linear-gradient(#fff2a8, #ffe14d 45%, #f5c400 55%, #ffd21f)',
  color: '#3a2f00',
  border: '3px solid #6b5a00',
  borderRadius: 14,
  boxShadow: 'inset 0 3px 0 rgba(255, 255, 255, 0.7), 0 5px 0 #a88800, 0 9px 12px rgba(0, 0, 0, 0.3)',
  textShadow: '0 1px 0 rgba(255, 255, 255, 0.6)',
  fontStyle: 'italic',
  letterSpacing: '0.02em',
};
