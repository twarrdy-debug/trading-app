import type { Candle } from './analysis.ts';

/**
 * Calculator PRO: a level from a signal is looked up on the candle it came from (a high, a low, an
 * open or a close) and read from the same candle on the other market, instead of shifting it by the
 * difference between the markets. Pure functions shared by the API and clients.
 */

export const PRO_RESOLUTIONS = ['M1', 'M5', 'M15', 'H1', 'H4'] as const;
export type ProResolution = (typeof PRO_RESOLUTIONS)[number];

export const PRO_RESOLUTION_MS: Record<ProResolution, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 4 * 3_600_000,
};

export type CandlePoint = 'high' | 'low' | 'open' | 'close';

/** A candle whose high, low, open or close lies at the level (within the tolerance). */
export interface CandleHit {
  time: string;
  point: CandlePoint;
  /** The candle's own price at that point. */
  price: number;
}

/** Wicks first: a level is far more often a high or a low than an open or a close. */
const POINTS: CandlePoint[] = ['high', 'low', 'close', 'open'];

/** A point this close (a tenth of the tolerance) is the level itself, typed from the same chart. */
const EXACT_SHARE = 0.1;

/**
 * Candles with a point at `price`, at most `limit`: candles exactly at the level first, then the
 * rest, newest first within each. Per candle the closest point counts (a wick before the body when
 * equally close).
 */
export function findCandleHits(candles: readonly Candle[], price: number, tolerance: number, limit = 6): CandleHit[] {
  const exact: CandleHit[] = [];
  const near: CandleHit[] = [];
  for (let i = candles.length - 1; i >= 0 && exact.length < limit; i--) {
    const c = candles[i]!;
    let best: CandleHit | null = null;
    let bestGap = Infinity;
    for (const point of POINTS) {
      const gap = Math.abs(c[point] - price);
      if (gap <= tolerance + 1e-9 && gap < bestGap - 1e-9) {
        best = { time: c.time, point, price: c[point] };
        bestGap = gap;
      }
    }
    if (best) (bestGap <= tolerance * EXACT_SHARE + 1e-9 ? exact : near).push(best);
  }
  return [...exact, ...near].slice(0, limit);
}

/** The same point of the other market's candle opened at the same time, if it has one. */
export function readAtHit(candles: readonly Candle[], hit: CandleHit): number | null {
  const c = candles.find((k) => k.time === hit.time);
  return c ? c[hit.point] : null;
}

/**
 * Candles merged into longer ones of `ms` (UTC buckets, e.g. four hours from 00:00 like Capital.com's
 * H4); a later point in the same bucket (a live quote) extends it.
 */
export function aggregateCandles(candles: readonly Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const start = new Date(Math.floor(Date.parse(c.time) / ms) * ms).toISOString();
    const last = out.at(-1);
    if (last && last.time === start) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ time: start, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}
