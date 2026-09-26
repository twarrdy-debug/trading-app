import { CFD_FUTURES_PAIRS } from '@trading/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { basisSnapshots } from '../db/schema.ts';

export interface Quote {
  price: number;
  /** When the market last traded at this price (not when it was fetched). */
  time: Date;
}

export type QuoteSource = { provider: 'yahoo' | 'gold-api'; symbol: string };

export interface QuoteProvider {
  fetchQuote(source: QuoteSource): Promise<Quote>;
}

/**
 * Reference prices for each pair. CFDs follow the cash index (or spot gold), futures the
 * front-month contract. These are unofficial free sources, good for personal use; switch to
 * a licensed feed before offering the app to other users.
 */
export const BASIS_SOURCES: Record<string, { cfd: QuoteSource; futures: QuoteSource }> = {
  nasdaq: { cfd: { provider: 'yahoo', symbol: '^NDX' }, futures: { provider: 'yahoo', symbol: 'NQ=F' } },
  sp500: { cfd: { provider: 'yahoo', symbol: '^GSPC' }, futures: { provider: 'yahoo', symbol: 'ES=F' } },
  dow: { cfd: { provider: 'yahoo', symbol: '^DJI' }, futures: { provider: 'yahoo', symbol: 'YM=F' } },
  gold: { cfd: { provider: 'gold-api', symbol: 'XAU' }, futures: { provider: 'yahoo', symbol: 'GC=F' } },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const liveQuoteProvider: QuoteProvider = {
  async fetchQuote({ provider, symbol }) {
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
};

/** Quotes further apart than this are not the same moment. */
const MAX_QUOTE_GAP_MS = 20 * 60_000;
/** A futures quote older than this means the market is closed. */
const MAX_QUOTE_AGE_MS = 30 * 60_000;

export type MeasureResult =
  | { pairKey: string; status: 'saved'; snapshot: typeof basisSnapshots.$inferSelect }
  | { pairKey: string; status: 'unchanged' | 'error'; message: string };

export async function measureBasis(db: DB, quotes: QuoteProvider, pairKey: string, now = new Date()): Promise<MeasureResult> {
  const sources = BASIS_SOURCES[pairKey];
  if (!sources) return { pairKey, status: 'error', message: `Nieznana para ${pairKey}` };

  let cfd: Quote;
  let futures: Quote;
  try {
    [cfd, futures] = await Promise.all([quotes.fetchQuote(sources.cfd), quotes.fetchQuote(sources.futures)]);
  } catch (err) {
    return { pairKey, status: 'error', message: `Nie udało się pobrać cen: ${(err as Error).message}` };
  }

  // No new futures trade since the last snapshot (weekend, holiday): nothing to record.
  const [latest] = await db
    .select()
    .from(basisSnapshots)
    .where(eq(basisSnapshots.pairKey, pairKey))
    .orderBy(desc(basisSnapshots.measuredAt))
    .limit(1);
  if (latest && latest.futuresQuotedAt.getTime() === futures.time.getTime()) {
    return { pairKey, status: 'unchanged', message: 'Brak nowych notowań (rynek zamknięty)' };
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
