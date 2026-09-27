/**
 * Veil's design tokens (src/ui/styles/tokens.css), dark theme: the film is
 * set in the product's own palette, type and motion curves.
 */
import { loadFont } from '@remotion/fonts';
import { Easing } from 'remotion';
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';
import interLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2';

export const FAMILY = 'Inter Veil';
export const FONT = `'${FAMILY}', system-ui, sans-serif`;

void loadFont({ family: FAMILY, url: interLatin, weight: '100 900' });
void loadFont({
  family: FAMILY,
  url: interLatinExt,
  weight: '100 900',
  unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F',
});

export const C = {
  bg: '#0d0e12',
  bgElevated: '#121318',
  surface: '#17181e',
  surface2: '#1e1f27',
  surface3: '#262833',
  border: 'rgba(255, 255, 255, 0.075)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  text: '#eceef3',
  text2: '#a6a9b6',
  text3: '#9598a5',
  accent: '#8387f4',
  accentText: '#a9acff',
  accentSoft: 'rgba(131, 135, 244, 0.13)',
  accentSoftStrong: 'rgba(131, 135, 244, 0.2)',
  onAccent: '#0e0f1a',
  positive: '#3fcb91',
  positiveSoft: 'rgba(63, 203, 145, 0.13)',
  caution: '#e7a73f',
  cautionSoft: 'rgba(231, 167, 63, 0.14)',
  critical: '#f0707a',
  criticalSoft: 'rgba(240, 112, 122, 0.13)',
  toggleOff: '#3a3c48',
  veilSurface: '#34363c',
  // Brand icon (static/brand/icon.svg)
  iconTop: '#30335a',
  iconBottom: '#15161f',
  markLight: '#b9bcff',
  markDeep: '#7d82f2',
  markFront: '#f3f4ff',
  // Light theme, for web pages shown inside the browser
  lightBg: '#f5f5f7',
  lightSurface: '#ffffff',
  lightSurface2: '#f2f2f5',
  lightSurface3: '#e9e9ee',
  lightText: '#15161c',
  lightText2: '#565968',
  lightBorder: 'rgba(24, 25, 38, 0.08)',
  lightAccent: '#5357d4',
} as const;

export const SHADOW_LG = '0 2px 6px rgba(0, 0, 0, 0.4), 0 28px 60px -20px rgba(0, 0, 0, 0.75)';
export const SHADOW_XL = '0 4px 12px rgba(0, 0, 0, 0.35), 0 60px 120px -40px rgba(0, 0, 0, 0.85)';

/** --ease-out: most transitions in the product. */
export const easeOut = Easing.bezier(0.2, 0.8, 0.2, 1);
/** --ease-in-out */
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
/** A longer, softer settle for camera moves and word reveals. */
export const expoOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeIn = Easing.bezier(0.55, 0, 0.8, 0.2);

/** Accent gradient for emphasised words and the mark. */
export const ACCENT_GRADIENT = `linear-gradient(180deg, #d4d6ff 0%, ${'#a9acff'} 45%, ${'#7d82f2'} 100%)`;
