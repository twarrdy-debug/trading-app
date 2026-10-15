import { findSwings, type Candle } from './analysis.ts';
import { MARKET_SESSIONS, windows } from './sessions.ts';

/**
 * Chart indicators and smart-money-concept zones from OHLC candles, our own definitions of widely
 * known ideas (not ports of any published script). Every series is aligned with the candles: null
 * where a value is not defined yet.
 */

/** Exponential moving average; the first value is the simple average of the first `period` closes. */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = values[i]! * k + current * (1 - k);
    out[i] = current;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** MACD line (fast − slow EMA), its signal EMA and the histogram. */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v != null);
  const signal: (number | null)[] = Array(closes.length).fill(null);
  if (start >= 0) {
    const sig = ema(line.slice(start) as number[], signalPeriod);
    sig.forEach((v, i) => (signal[start + i] = v));
  }
  const histogram = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { line, signal, histogram };
}

export interface Zone {
  kind: 'fvg' | 'ob';
  direction: 'bull' | 'bear';
  /** The candle the zone starts at. */
  time: string;
  top: number;
  bottom: number;
  /** When it was filled (FVG) or closed through (OB); null while it still stands. */
  endedAt: string | null;
}

export interface StructureBreak {
  kind: 'bos' | 'choch';
  direction: 'bull' | 'bear';
  /** The swing that was broken and the candle that closed beyond it. */
  from: string;
  to: string;
  price: number;
}

/**
 * Fair value gaps: three candles where the third's low is above the first's high (bullish) or its
 * high below the first's low (bearish), at least `minSize` wide. A gap ends once price trades back
 * through its far side.
 */
export function findFvgs(candles: readonly Candle[], minSize = 0): Zone[] {
  const zones: (Zone & { index: number })[] = [];
  for (let i = 2; i < candles.length; i++) {
    const first = candles[i - 2]!;
    const third = candles[i]!;
    if (third.low > first.high && third.low - first.high >= minSize)
      zones.push({ kind: 'fvg', direction: 'bull', time: candles[i - 1]!.time, top: third.low, bottom: first.high, endedAt: null, index: i });
    if (third.high < first.low && first.low - third.high >= minSize)
      zones.push({ kind: 'fvg', direction: 'bear', time: candles[i - 1]!.time, top: first.low, bottom: third.high, endedAt: null, index: i });
  }
  return zones.map(({ index, ...zone }) => {
    const filler = candles.slice(index + 1).find((c) => (zone.direction === 'bull' ? c.low <= zone.bottom : c.high >= zone.top));
    return { ...zone, endedAt: filler?.time ?? null };
  });
}

/**
 * Market structure from swings: a close beyond the last swing high (low) is a break; with the
 * trend it is a BOS, against it (the first break the other way) a CHoCH. Each break leaves an order
 * block: the last opposite candle before it, which ends once a candle closes through it.
 */
export function findStructure(candles: readonly Candle[], strength = 3): { breaks: StructureBreak[]; orderBlocks: Zone[] } {
  const swings = findSwings(candles, strength);
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const breaks: StructureBreak[] = [];
  const blocks: (Zone & { index: number })[] = [];
  let trend: 'bull' | 'bear' | null = null;
  let high: { i: number; price: number } | null = null;
  let low: { i: number; price: number } | null = null;
  let next = 0;
  for (let i = 0; i < candles.length; i++) {
    // A swing is known only once `strength` candles after it have closed.
    while (next < swings.length && index.get(swings[next]!.time)! + strength <= i) {
      const s = swings[next++]!;
      if (s.kind === 'high') high = { i: index.get(s.time)!, price: s.price };
      else low = { i: index.get(s.time)!, price: s.price };
    }
    const c = candles[i]!;
    for (const direction of ['bull', 'bear'] as const) {
      const level = direction === 'bull' ? high : low;
      if (!level || (direction === 'bull' ? c.close <= level.price : c.close >= level.price)) continue;
      breaks.push({ kind: trend && trend !== direction ? 'choch' : 'bos', direction, from: candles[level.i]!.time, to: c.time, price: level.price });
      const startFrom = (direction === 'bull' ? low?.i : high?.i) ?? Math.max(0, i - 20);
      for (let j = i - 1; j >= startFrom; j--) {
        const k = candles[j]!;
        if (direction === 'bull' ? k.close < k.open : k.close > k.open) {
          blocks.push({ kind: 'ob', direction, time: k.time, top: k.high, bottom: k.low, endedAt: null, index: j });
          break;
        }
      }
      trend = direction;
      if (direction === 'bull') high = null;
      else low = null;
    }
  }
  const orderBlocks = blocks.map(({ index: from, ...zone }) => {
    const breaker = candles.slice(from + 1).find((c) => (zone.direction === 'bull' ? c.close < zone.bottom : c.close > zone.top));
    return { ...zone, endedAt: breaker?.time ?? null };
  });
  return { breaks, orderBlocks };
}

/**
 * Premium and discount from the range of the last `lookback` candles: the top 5% is premium, the
 * bottom 5% discount, and equilibrium a band around the middle.
 */
export function premiumDiscount(candles: readonly Candle[], lookback = 100) {
  const recent = candles.slice(-lookback);
  if (recent.length < 2) return null;
  const top = Math.max(...recent.map((c) => c.high));
  const bottom = Math.min(...recent.map((c) => c.low));
  const span = top - bottom;
  const mid = (top + bottom) / 2;
  return {
    from: recent[0]!.time,
    top,
    bottom,
    premium: { top, bottom: top - span * 0.05 },
    equilibrium: { top: mid + span * 0.025, bottom: mid - span * 0.025 },
    discount: { top: bottom + span * 0.05, bottom },
  };
}

export type SessionLevelKey = 'tokyo' | 'london' | 'newyork';

/**
 * High and low of the Asian (Tokyo), London and New York sessions on the last `days` session days
 * covered by the candles (each in its own city's hours). Candles should be intraday (H1 or finer).
 */
export function sessionLevels(candles: readonly Candle[], days = 2) {
  if (candles.length === 0) return [];
  const last = new Date(candles.at(-1)!.time);
  const out: { session: SessionLevelKey; date: string; start: string; end: string; high: number; low: number; open: boolean }[] = [];
  for (const session of MARKET_SESSIONS.filter((s) => s.key !== 'sydney')) {
    const recent = windows(session, last, 6, 0).filter((w) => w.start <= last).slice(-days);
    for (const w of recent) {
      const inside = candles.filter((c) => {
        const t = new Date(c.time);
        return t >= w.start && t < w.end;
      });
      if (inside.length === 0) continue;
      out.push({
        session: session.key as SessionLevelKey,
        date: w.date ?? '',
        start: inside[0]!.time,
        end: inside.at(-1)!.time,
        high: Math.max(...inside.map((c) => c.high)),
        low: Math.min(...inside.map((c) => c.low)),
        open: last < w.end,
      });
    }
  }
  return out;
}
