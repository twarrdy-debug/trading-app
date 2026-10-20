import { aggregateCandles, CFD_FUTURES_PAIRS, PRO_RESOLUTION_MS, type Candle, type ProResolution } from '@trading/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { basisSnapshots } from '../db/schema.ts';
import type { MarketDataProvider } from './market-data.ts';

export interface Quote {
  price: number;
  /** When the market last traded at this price (not when it was fetched). */
  time: Date;
}

export type QuoteSource = { provider: 'capital' | 'yahoo' | 'gold-api'; symbol: string };

export interface QuoteProvider {
  fetchQuote(source: QuoteSource): Promise<Quote>;
  /**
   * The price at a past moment, where the source has history (Capital.com): the CFD is read at the
   * futures quote's own minute, since the free futures feed is about 10 minutes late.
   */
  fetchQuoteAt?(source: QuoteSource, at: Date): Promise<Quote>;
  /** Futures candles for the calculator PRO (Yahoo, about 10 minutes late), oldest first. */
  fetchCandles?(symbol: string, resolution: ProResolution): Promise<Candle[]>;
}

/**
 * Reference prices for each pair. The CFD side is the broker CFD price from Capital.com when it is
 * configured, otherwise the cash index (or spot gold); the futures side is the front-month
 * contract. These are unofficial free sources, good for personal use; switch to a licensed feed
 * before offering the app to other users.
 */
export const BASIS_SOURCES: Record<string, { cfd: QuoteSource[]; futures: QuoteSource }> = {
  nasdaq: { cfd: [{ provider: 'capital', symbol: 'US100' }, { provider: 'yahoo', symbol: '^NDX' }], futures: { provider: 'yahoo', symbol: 'NQ=F' } },
  sp500: { cfd: [{ provider: 'capital', symbol: 'US500' }, { provider: 'yahoo', symbol: '^GSPC' }], futures: { provider: 'yahoo', symbol: 'ES=F' } },
  dow: { cfd: [{ provider: 'capital', symbol: 'US30' }, { provider: 'yahoo', symbol: '^DJI' }], futures: { provider: 'yahoo', symbol: 'YM=F' } },
  gold: { cfd: [{ provider: 'capital', symbol: 'GOLD' }, { provider: 'gold-api', symbol: 'XAU' }], futures: { provider: 'yahoo', symbol: 'GC=F' } },
  // Crypto: the CFD from Capital.com, otherwise the spot price; CME futures from Yahoo.
  bitcoin: { cfd: [{ provider: 'capital', symbol: 'BTCUSD' }, { provider: 'yahoo', symbol: 'BTC-USD' }], futures: { provider: 'yahoo', symbol: 'BTC=F' } },
  ether: { cfd: [{ provider: 'capital', symbol: 'ETHUSD' }, { provider: 'yahoo', symbol: 'ETH-USD' }], futures: { provider: 'yahoo', symbol: 'ETH=F' } },
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Yahoo's interval and history per resolution (it keeps 1m for about a week, 5m and 15m for 60 days);
 * H4 is built from hours. Enough to cover the CFD candles the calculator shows.
 */
const YAHOO_CANDLES: Record<ProResolution, { interval: string; range: string }> = {
  M1: { interval: '1m', range: '5d' },
  M5: { interval: '5m', range: '10d' },
  M15: { interval: '15m', range: '30d' },
  H1: { interval: '60m', range: '3mo' },
  H4: { interval: '60m', range: '1y' },
};

async function yahooCandles(symbol: string, resolution: ProResolution): Promise<Candle[]> {
  const { interval, range } = YAHOO_CANDLES[resolution];
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const body = (await res.json()) as {
    chart: { result: { timestamp?: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] } }[] | null };
  };
  const result = body.chart.result?.[0];
  const q = result?.indicators.quote[0];
  if (!result?.timestamp || !q) throw new Error(`Yahoo ${symbol}: brak danych`);
  const raw: Candle[] = [];
  result.timestamp.forEach((ts, i) => {
    const [open, high, low, close] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (open == null || high == null || low == null || close == null) return;
    raw.push({ time: new Date(ts * 1000).toISOString(), open: round6(open), high: round6(high), low: round6(low), close: round6(close) });
  });
  // The last point is the live quote at an odd second: it joins its candle (and hours join into H4).
  return aggregateCandles(raw, PRO_RESOLUTION_MS[resolution]);
}

/** Live quotes; Capital.com ones need its market data provider (without it they fail and the next source is used). */
export const createQuoteProvider = (market: MarketDataProvider | null): QuoteProvider => ({
  fetchCandles: yahooCandles,
  async fetchQuoteAt({ provider, symbol }, at) {
    if (provider !== 'capital' || !market) throw new Error(`${provider} has no price history`);
    return market.fetchQuoteAt(symbol, at);
  },
  async fetchQuote({ provider, symbol }) {
    if (provider === 'capital') {
      if (!market) throw new Error('Capital.com not configured');
      return market.fetchQuote(symbol);
    }
    const signal = AbortSignal.timeout(8_000);
    if (provider === 'gold-api') {
      const res = await fetch(`https://api.gold-api.com/price/${symbol}`, { signal });
      if (!res.ok) throw new Error(`gold-api ${res.status}`);
      const body = (await res.json()) as { price: number; updatedAt: string };
      return { price: round2(body.price), time: new Date(body.updatedAt) };
    }
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`, {
      signal,
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
    const body = (await res.json()) as {
      chart: { result: { meta: { regularMarketPrice: number; regularMarketTime: number } }[] | null };
    };
    const meta = body.chart.result?.[0]?.meta;
    if (!meta) throw new Error(`Yahoo ${symbol}: brak danych`);
    return { price: round2(meta.regularMarketPrice), time: new Date(meta.regularMarketTime * 1000) };
  },
});

export const liveQuoteProvider = createQuoteProvider(null);

/**
 * The first CFD source that answers, and which one it was. With `at` (the futures quote's time) a
 * source with history is read at that minute, so both prices come from the same moment.
 */
async function firstQuote(quotes: QuoteProvider, sources: QuoteSource[], at?: Date): Promise<{ quote: Quote; source: QuoteSource }> {
  let error: unknown;
  for (const source of sources) {
    try {
      if (at && quotes.fetchQuoteAt && source.provider === 'capital') return { quote: await quotes.fetchQuoteAt(source, at), source };
      return { quote: await quotes.fetchQuote(source), source };
    } catch (err) {
      error = err;
    }
  }
  throw error;
}

/** Quotes further apart than this are not the same moment. */
const MAX_QUOTE_GAP_MS = 20 * 60_000;
/** A futures quote older than this means the market is closed. */
const MAX_QUOTE_AGE_MS = 30 * 60_000;

export type MeasureResult =
  | { pairKey: string; status: 'saved'; snapshot: typeof basisSnapshots.$inferSelect }
  | { pairKey: string; status: 'unchanged' | 'error'; message: string };

export async function measureBasis(db: DB, quotes: QuoteProvider, pairKey: string, now = new Date()): Promise<MeasureResult> {
  const sources = BASIS_SOURCES[pairKey];
  if (!sources) return { pairKey, status: 'error', message: `unknown pair ${pairKey}` };

  let cfd: Quote;
  let cfdSource: QuoteSource;
  let futures: Quote;
  try {
    // Futures first: the CFD is then read at the futures quote's minute (the futures feed is late).
    futures = await quotes.fetchQuote(sources.futures);
    const first = await firstQuote(quotes, sources.cfd, futures.time);
    cfd = first.quote;
    cfdSource = first.source;
  } catch (err) {
    return { pairKey, status: 'error', message: (err as Error).message };
  }

  // No new futures trade since the last snapshot (weekend, holiday): nothing to record.
  const [latest] = await db
    .select()
    .from(basisSnapshots)
    .where(eq(basisSnapshots.pairKey, pairKey))
    .orderBy(desc(basisSnapshots.measuredAt))
    .limit(1);
  if (latest && latest.futuresQuotedAt.getTime() === futures.time.getTime()) {
    return { pairKey, status: 'unchanged', message: 'no new quotes' };
  }

  const live =
    Math.abs(cfd.time.getTime() - futures.time.getTime()) <= MAX_QUOTE_GAP_MS &&
    now.getTime() - futures.time.getTime() <= MAX_QUOTE_AGE_MS;

  const [snapshot] = await db
    .insert(basisSnapshots)
    .values({
      pairKey,
      cfdPrice: cfd.price,
      futuresPrice: futures.price,
      difference: Math.round((futures.price - cfd.price) * 100) / 100,
      cfdQuotedAt: cfd.time,
      cfdSource: cfdSource.provider,
      futuresQuotedAt: futures.time,
      live,
      measuredAt: now,
    })
    .returning();
  return { pairKey, status: 'saved', snapshot: snapshot! };
}

export const measureAll = (db: DB, quotes: QuoteProvider, now = new Date()) =>
  Promise.all(CFD_FUTURES_PAIRS.map((p) => measureBasis(db, quotes, p.key, now)));

/**
 * Latest snapshot per pair, with the change since the previous live one. `alert` is set when
 * the latest live difference moved by more than the pair's threshold.
 */
export async function basisOverview(db: DB) {
  return Promise.all(
    CFD_FUTURES_PAIRS.map(async (pair) => {
      const history = await db
        .select()
        .from(basisSnapshots)
        .where(eq(basisSnapshots.pairKey, pair.key))
        .orderBy(desc(basisSnapshots.measuredAt))
        .limit(8);
      const latest = history[0] ?? null;
      const [latestLive, previousLive] = await db
        .select()
        .from(basisSnapshots)
        .where(and(eq(basisSnapshots.pairKey, pair.key), eq(basisSnapshots.live, true)))
        .orderBy(desc(basisSnapshots.measuredAt))
        .limit(2);
      const change =
        latestLive && previousLive ? Math.round((latestLive.difference - previousLive.difference) * 100) / 100 : null;
      return {
        pairKey: pair.key,
        alertPoints: pair.alertPoints,
        latest,
        latestLive: latestLive ?? null,
        previousLive: previousLive ?? null,
        change,
        alert: change != null && Math.abs(change) > pair.alertPoints,
        history,
      };
    }),
  );
}

/** Measures every `hours` hours (and shortly after start). Returns a stop function. */
export function startBasisScheduler(db: DB, quotes: QuoteProvider, hours: number, log: (msg: string) => void) {
  const run = async () => {
    const results = await measureAll(db, quotes);
    log(`Pomiar różnic CFD/futures: ${results.map((r) => `${r.pairKey} ${r.status}`).join(', ')}`);
  };
  const first = setTimeout(() => void run(), 15_000);
  const timer = setInterval(() => void run(), hours * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
