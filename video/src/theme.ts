// One typeface, a dark background, nothing else. Inter comes from Google Fonts at render time.
import {loadFont} from '@remotion/google-fonts/Inter';

const {fontFamily} = loadFont('normal', {weights: ['400', '600'], subsets: ['latin']});

export const theme = {
  bg: '#0b0c10',
  fg: '#e6e6e6',
  muted: '#9aa0a8',
  accent: '#e60012',
  fontFamily: `${fontFamily}, system-ui, -apple-system, "Segoe UI", sans-serif`,
};
