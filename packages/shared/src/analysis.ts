import { findPairBySymbol } from './instruments.ts';

/**
 * Daily analysis from OHLC candles: swing highs and lows, equal highs and lows (resting liquidity),
 * the previous day's and week's range and ATR. Pure functions shared by the API and clients.
 */

export const ANALYSIS_RESOLUTIONS = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
export type AnalysisResolution = (typeof ANALYSIS_RESOLUTIONS)[number];
/** Resolutions fetched and stored; M3 is built from M1 (Capital.com has no three-minute candles). */
export const STORED_RESOLUTIONS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
export type StoredResolution = (typeof STORED_RESOLUTIONS)[number];

/** Length of one candle of each resolution, in ms. */
export const RESOLUTION_MS: Record<AnalysisResolution, number> = {
  M1: 60_000,
  M3: 180_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 4 * 3_600_000,
  D1: 24 * 3_600_000,
};

export interface Candle {
  /** Opening time, ISO string in UTC. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Swing {
  kind: 'high' | 'low';
  time: string;
  price: number;
  /** A later candle traded beyond it (a high taken out, a low broken). */
  broken: boolean;
  brokenAt: string | null;
}

export interface EqualLevel {
  kind: 'highs' | 'lows';
  /** Average price of the touches. */
  price: number;
  /** The touches' range: the zone where the liquidity rests. */
  top: number;
  bottom: number;
  touches: { time: string; price: number }[];
  /** Price went beyond the zone after the last touch (the liquidity was taken). */
  swept: boolean;
  sweptAt: string | null;
}

/**
 * Market data symbols on Capital.com for the app's instruments. Futures have no source there, so
 * their analysis uses the paired CFD's candles shifted by the measured basis (see `analysisSource`).
 */
export const CAPITAL_EPICS: Record<string, string> = {
  US100: 'US100',
  US500: 'US500',
  US30: 'US30',
  XAUUSD: 'GOLD',
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY',
  USDCHF: 'USDCHF',
  AUDUSD: 'AUDUSD',
  USDCAD: 'USDCAD',
  NZDUSD: 'NZDUSD',
  BTCUSD: 'BTCUSD',
  ETHUSD: 'ETHUSD',
  // Exchange perpetuals follow the coin's price closely enough for levels: the CFD's candles.
  BTCUSDT: 'BTCUSD',
  ETHUSDT: 'ETHUSD',
};

/** Where an instrument's candles come from: its own epic, or (futures) the paired CFD's. */
export function analysisSource(symbol: string): { epic: string; via: string | null } | null {
  const own = CAPITAL_EPICS[symbol];
  if (own) return { epic: own, via: null };
  const pair = findPairBySymbol(symbol);
  if (pair?.side === 'futures') {
    const epic = CAPITAL_EPICS[pair.pair.cfd];
    if (epic) return { epic, via: pair.pair.cfd };
  }
  return null;
}

/**
 * Swing highs and lows as fractals: a high above the `strength` candles on each side (equal to the
 * ones after it counts, so a double top marks its first peak), a low likewise below. The last
 * `strength` candles cannot be swings yet. Each swing says whether a later candle went beyond it.
 */
export function findSwings(candles: readonly Candle[], strength = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const c = candles[i]!;
    let high = true;
    let low = true;
    for (let k = 1; k <= strength; k++) {
      const before = candles[i - k]!;
      const after = candles[i + k]!;
      if (before.high >= c.high || after.high > c.high) high = false;
      if (before.low <= c.low || after.low < c.low) low = false;
    }
    if (high) swings.push(withBreak(candles, i, 'high'));
    if (low) swings.push(withBreak(candles, i, 'low'));
  }
  return swings;
}

function withBreak(candles: readonly Candle[], i: number, kind: 'high' | 'low'): Swing {
  const c = candles[i]!;
  const price = kind === 'high' ? c.high : c.low;
  const breaker = candles.slice(i + 1).find((later) => (kind === 'high' ? later.high > price : later.low < price));
  return { kind, time: c.time, price, broken: breaker != null, brokenAt: breaker?.time ?? null };
}

/** Average true range over the last `period` candles (null with too few). */
export function atr(candles: readonly Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  return sum / period;
}

/**
 * Equal highs and lows: swings of one kind whose prices lie within `tolerance` of each other, with
 * no candle in between trading beyond the zone (otherwise the earlier one was already taken). They
 * mark resting liquidity; `swept` says price has since gone through the zone.
 */
export function findEqualLevels(candles: readonly Candle[], swings: readonly Swing[], tolerance: number): EqualLevel[] {
  const levels: EqualLevel[] = [];
  const index = new Map(candles.map((c, i) => [c.time, i]));
  for (const kind of ['high', 'low'] as const) {
    const points = swings.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let a = 0; a < points.length; a++) {
      if (used.has(a)) continue;
      const group = [points[a]!];
      for (let b = a + 1; b < points.length; b++) {
        if (used.has(b)) continue;
        const candidate = points[b]!;
        const top = Math.max(...group.map((p) => p.price), candidate.price);
        const bottom = Math.min(...group.map((p) => p.price), candidate.price);
        if (top - bottom > tolerance) continue;
        // Between the last touch and this one price must stay inside the zone's far side.
        const from = index.get(group.at(-1)!.time)!;
        const to = index.get(candidate.time)!;
        const between = candles.slice(from + 1, to);
        const intact = kind === 'high' ? between.every((c) => c.high <= top) : between.every((c) => c.low >= bottom);
        if (!intact) continue;
        group.push(candidate);
        used.add(b);
      }
      if (group.length < 2) continue;
      used.add(a);
      const top = Math.max(...group.map((p) => p.price));
      const bottom = Math.min(...group.map((p) => p.price));
      const last = index.get(group.at(-1)!.time)!;
      const sweeper = candles.slice(last + 1).find((c) => (kind === 'high' ? c.high > top : c.low < bottom));
      levels.push({
        kind: kind === 'high' ? 'highs' : 'lows',
        price: group.reduce((sum, p) => sum + p.price, 0) / group.length,
        top,
        bottom,
        touches: group.map((p) => ({ time: p.time, price: p.price })),
        swept: sweeper != null,
        sweptAt: sweeper?.time ?? null,
      });
    }
  }
  return levels.sort((x, y) => x.touches.at(-1)!.time.localeCompare(y.touches.at(-1)!.time));
}

/** Monday of the UTC week a candle falls in. */
const weekOf = (time: string) => {
  const d = new Date(time);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export interface DayLevels {
  /** Previous trading day's high, low and close. */
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
  /** Previous week's high and low. */
  pwh: number | null;
  pwl: number | null;
  /** Today's opening price (the last daily candle). */
  todayOpen: number | null;
  /** This week's and this month's opening price. */
  weekOpen: number | null;
  monthOpen: number | null;
  /** Previous month's high and low. */
  pmh: number | null;
  pml: number | null;
}

/**
 * The previous day's and week's range from daily candles (UTC days, as the data source cuts them).
 * Weekend candles with little trading are skipped as "previous day".
 */
export function dayLevels(daily: readonly Candle[]): DayLevels {
  const today = daily.at(-1);
  const weekdays = daily.slice(0, -1).filter((c) => {
    const day = new Date(c.time).getUTCDay();
    return day !== 0 && day !== 6;
  });
  const previous = weekdays.at(-1);
  const thisWeek = today ? weekOf(today.time) : null;
  const lastWeek = daily.filter((c) => weekOf(c.time) !== thisWeek);
  const previousWeek = lastWeek.length ? weekOf(lastWeek.at(-1)!.time) : null;
  const week = lastWeek.filter((c) => weekOf(c.time) === previousWeek);
  const monthOf = (time: string) => time.slice(0, 7);
  const thisMonth = today ? monthOf(today.time) : null;
  const earlier = daily.filter((c) => monthOf(c.time) !== thisMonth);
  const previousMonth = earlier.length ? monthOf(earlier.at(-1)!.time) : null;
  const month = earlier.filter((c) => monthOf(c.time) === previousMonth);
  return {
    pdh: previous?.high ?? null,
    pdl: previous?.low ?? null,
    pdc: previous?.close ?? null,
    pwh: week.length ? Math.max(...week.map((c) => c.high)) : null,
    pwl: week.length ? Math.min(...week.map((c) => c.low)) : null,
    todayOpen: today?.open ?? null,
    weekOpen: thisWeek ? (daily.find((c) => weekOf(c.time) === thisWeek)?.open ?? null) : null,
    // The first candle of the month in the data: only when the data reaches back to its first days.
    monthOpen: thisMonth && earlier.length ? (daily.find((c) => monthOf(c.time) === thisMonth)?.open ?? null) : null,
    pmh: month.length ? Math.max(...month.map((c) => c.high)) : null,
    pml: month.length ? Math.min(...month.map((c) => c.low)) : null,
  };
}

/** A live price: the bid at a moment. */
export interface LivePrice {
  time: string;
  price: number;
}

/**
 * The candles with the live price applied: the last candle extended (high, low, close), or a new
 * one opened when the price falls into the next period. Daily candles are only extended, since the
 * source starts its days at its own hour.
 */
export function withLivePrice(candles: Candle[], live: LivePrice | null, periodMs: number, daily = false): Candle[] {
  const last = candles.at(-1);
  if (!last || !live) return candles;
  const at = Date.parse(live.time);
  const lastStart = Date.parse(last.time);
  if (at < lastStart) return candles;
  const start = Math.floor(at / periodMs) * periodMs;
  if (daily || start <= lastStart) {
    const updated = { ...last, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price), close: live.price };
    return [...candles.slice(0, -1), updated];
  }
  return [...candles, { time: new Date(start).toISOString(), open: live.price, high: live.price, low: live.price, close: live.price }];
}
