/**
 * Candle colours on the analysis chart (owner, 2026-10-19: calm colours that do not stir emotions,
 * chosen from https://claude.ai/artifact/CAXyzLEWQxsWzpg5AtLPJR). Each palette has a shade per theme;
 * "custom" uses the user's own two colours in both themes. The chart stays Lightweight Charts.
 */
export const CANDLE_PALETTES = {
  mist: { dark: { up: '#7fb3ae', down: '#b98b92' }, light: { up: '#4c8b86', down: '#a46f78' } },
  sage: { dark: { up: '#94ae8f', down: '#c49b80' }, light: { up: '#6c8d66', down: '#a7765a' } },
  depth: { dark: { up: '#77a2d3', down: '#7f8999' }, light: { up: '#3e72ab', down: '#6d7787' } },
  mono: { dark: { up: '#c9d1dc', down: '#6b7685' }, light: { up: '#5f6b7a', down: '#3a4350' } },
  classic: { dark: { up: '#26a69a', down: '#ef5350' }, light: { up: '#26a69a', down: '#ef5350' } },
} as const;

export type CandlePalette = keyof typeof CANDLE_PALETTES;
export const CANDLE_PALETTE_KEYS = ['mist', 'sage', 'depth', 'mono', 'classic'] as const satisfies readonly CandlePalette[];
/** Calm by default; the TradingView colours stay available as "classic". */
export const DEFAULT_CANDLE_PALETTE: CandlePalette = 'mist';

export interface ChartStyle {
  palette: CandlePalette | 'custom';
  /** Own colours, used with `palette: 'custom'`. */
  up?: string;
  down?: string;
  /** Rising candles drawn as outlines. */
  hollow: boolean;
}

/** The colours to draw with in a theme; no saved style means the calm default. */
export function candleColors(style: ChartStyle | null | undefined, theme: 'light' | 'dark') {
  const palette = style?.palette ?? DEFAULT_CANDLE_PALETTE;
  const base = CANDLE_PALETTES[palette === 'custom' ? DEFAULT_CANDLE_PALETTE : palette][theme];
  const own = palette === 'custom';
  return {
    up: own && style?.up ? style.up : base.up,
    down: own && style?.down ? style.down : base.down,
    hollow: style?.hollow ?? palette === 'mono',
  };
}
