import { CAPITAL_EPICS, CFD_FUTURES_PAIRS, type Candle, type ProResolution } from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { instruments } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { BASIS_SOURCES, type QuoteProvider } from './basis.ts';
import { loadCandles, refreshIfStale } from './market-analysis.ts';
import type { MarketDataProvider } from './market-data.ts';

/** Candles each chart gets: M5 about three days, H1 six weeks, H4 half a year. */
const COUNT = 1000;
/** Futures candles are kept this long in memory, not stored. */
const CACHE_MS = 60_000;
/** Yahoo's futures quotes are about this many minutes late. */
export const FUTURES_DELAY_MINUTES = 10;

const cache = new Map<string, { at: number; candles: Candle[] }>();

async function cached(key: string, load: () => Promise<Candle[]>) {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.candles;
  const candles = await load();
  cache.set(key, { at: Date.now(), candles });
  return candles;
}

/**
 * Both markets' candles of one pair for the calculator PRO: the CFD from Capital.com (the same
 * candles as the analysis), the futures from Yahoo (the front contract, about 10 minutes late).
 * An unofficial source for personal use, like the calculator's measurements.
 */
export async function proCandles(db: DB, market: MarketDataProvider | null, quotes: QuoteProvider, pairKey: string, resolution: ProResolution) {
  const pair = CFD_FUTURES_PAIRS.find((p) => p.key === pairKey);
  const futuresSymbol = BASIS_SOURCES[pairKey]?.futures.symbol;
  if (!pair || !futuresSymbol) throw badRequest('unknownInstrument');
  const epic = CAPITAL_EPICS[pair.cfd];

  const errors: { cfd: string | null; futures: string | null } = { cfd: null, futures: null };
  let cfd: Candle[] = [];
  if (!market || !epic) {
    errors.cfd = 'unavailable';
  } else {
    const [instrument] = await db.select({ id: instruments.id }).from(instruments).where(eq(instruments.symbol, pair.cfd));
    if (instrument) {
      errors.cfd = await refreshIfStale(db, market, instrument.id, epic, resolution);
      cfd = await loadCandles(db, instrument.id, resolution, COUNT);
    }
  }

  let futures: Candle[] = [];
  try {
    if (!quotes.fetchCandles) throw new Error('unavailable');
    futures = await cached(`fut:${futuresSymbol}:${resolution}`, () => quotes.fetchCandles!(futuresSymbol, resolution));
  } catch (err) {
    errors.futures = (err as Error).message;
  }
  // Only the stretch both charts cover.
  const from = cfd[0]?.time;
  if (from) futures = futures.filter((c) => c.time >= from);

  return {
    pairKey,
    resolution,
    cfd: { symbol: pair.cfd, source: 'capital' as const, candles: cfd },
    futures: {
      symbol: futuresSymbol,
      source: 'yahoo' as const,
      delayMinutes: FUTURES_DELAY_MINUTES,
      lastCandleAt: futures.at(-1)?.time ?? null,
      candles: futures,
    },
    errors,
  };
}
