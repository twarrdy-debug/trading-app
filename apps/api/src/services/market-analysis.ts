import {
  ANALYSIS_RESOLUTIONS,
  analysisSource,
  atr,
  CAPITAL_EPICS,
  dayLevels,
  findEqualLevels,
  findPairBySymbol,
  findSwings,
  type AnalysisResolution,
  type Candle,
} from '@trading/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { basisSnapshots, favoriteInstruments, instruments, ohlcCandles } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import type { MarketDataProvider } from './market-data.ts';

/** Candles the levels are computed on, and how many the chart gets (it scrolls back through them). */
const WINDOW = 600;
const CHART = 500;
/** Swing strength (candles on each side) per resolution. */
const STRENGTH: Record<AnalysisResolution, number> = { M5: 3, M15: 3, H1: 3, H4: 2, D1: 2 };
/** Equal highs/lows lie within this share of the ATR. */
const EQUAL_ATR_SHARE = 0.1;
/** Fetch again on demand when the last fetch is older than this (short timeframes sooner). */
const ON_DEMAND_MS: Record<AnalysisResolution, number> = { M5: 60_000, M15: 2 * 60_000, H1: 5 * 60_000, H4: 5 * 60_000, D1: 5 * 60_000 };
const SENTIMENT_MS = 5 * 60_000;

/** When each instrument × resolution was last fetched (this process). */
const fetched = new Map<string, number>();
const sentimentCache = new Map<string, { long: number; short: number; at: number }>();

/** Prices to 6 decimals, so a shifted price does not print as 4211.389999… */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Brings the stored candles up to date: the whole window the first time, then from the last stored one. */
export async function syncCandles(db: DB, market: MarketDataProvider, instrumentId: string, epic: string, resolution: AnalysisResolution) {
  const [latest] = await db
    .select({ ts: ohlcCandles.ts })
    .from(ohlcCandles)
    .where(and(eq(ohlcCandles.instrumentId, instrumentId), eq(ohlcCandles.timeframe, resolution)))
    .orderBy(desc(ohlcCandles.ts))
    .limit(1);
  // From the last stored candle (inclusive): it may still have been forming.
  const candles = await market.fetchCandles(epic, resolution, latest ? { from: latest.ts } : { max: 1000 });
  for (let i = 0; i < candles.length; i += 200) {
    const rows = candles.slice(i, i + 200).map((c) => ({
      instrumentId,
      timeframe: resolution,
      ts: new Date(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    await db
      .insert(ohlcCandles)
      .values(rows)
      .onConflictDoUpdate({
        target: [ohlcCandles.instrumentId, ohlcCandles.timeframe, ohlcCandles.ts],
        set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close` },
      });
  }
  fetched.set(`${instrumentId}:${resolution}`, Date.now());
  return candles.length;
}

/** Every instrument with its own Capital.com epic, every resolution. */
export async function syncAll(db: DB, market: MarketDataProvider) {
  const rows = await db.select({ id: instruments.id, symbol: instruments.symbol }).from(instruments).where(inArray(instruments.symbol, Object.keys(CAPITAL_EPICS)));
  let candles = 0;
  for (const row of rows) for (const resolution of ANALYSIS_RESOLUTIONS) candles += await syncCandles(db, market, row.id, CAPITAL_EPICS[row.symbol]!, resolution);
  return { instruments: rows.length, candles };
}

export function startAnalysisScheduler(db: DB, market: MarketDataProvider, minutes: number, log: (msg: string) => void) {
  const run = () =>
    syncAll(db, market).then(
      (r) => log(`analysis: ${r.candles} candles for ${r.instruments} instruments`),
      (err: Error) => log(`analysis: ${err.message}`),
    );
  void run();
  const timer = setInterval(run, minutes * 60_000);
  return () => clearInterval(timer);
}

async function loadCandles(db: DB, instrumentId: string, resolution: AnalysisResolution, limit: number): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(ohlcCandles)
    .where(and(eq(ohlcCandles.instrumentId, instrumentId), eq(ohlcCandles.timeframe, resolution)))
    .orderBy(desc(ohlcCandles.ts))
    .limit(limit);
  return rows.reverse().map((r) => ({ time: r.ts.toISOString(), open: r.open, high: r.high, low: r.low, close: r.close }));
}

async function sentimentFor(market: MarketDataProvider | null, epics: string[]) {
  const now = Date.now();
  const missing = epics.filter((e) => (sentimentCache.get(e)?.at ?? 0) < now - SENTIMENT_MS);
  if (market && missing.length) {
    try {
      for (const s of await market.fetchSentiment(missing)) sentimentCache.set(s.epic, { long: s.long, short: s.short, at: now });
    } catch {
      // Sentiment is optional: keep whatever is cached.
    }
  }
  return new Map(epics.map((e) => [e, sentimentCache.get(e) ?? null]));
}

/** The latest live futures − CFD difference for a futures instrument's pair (null when never measured). */
async function basisOffset(db: DB, symbol: string) {
  const pair = findPairBySymbol(symbol);
  if (!pair) return null;
  const [row] = await db
    .select()
    .from(basisSnapshots)
    .where(and(eq(basisSnapshots.pairKey, pair.pair.key), eq(basisSnapshots.live, true)))
    .orderBy(desc(basisSnapshots.measuredAt))
    .limit(1);
  return row ? { difference: row.difference, measuredAt: row.measuredAt } : null;
}

const shift = (c: Candle, by: number): Candle => ({ ...c, open: round(c.open + by), high: round(c.high + by), low: round(c.low + by), close: round(c.close + by) });

/**
 * The analysis of one instrument at one resolution: candles for the chart, swings, equal highs and
 * lows, the previous day's and week's levels, ATR and client sentiment. Futures use their paired
 * CFD's candles shifted by the latest measured difference between the markets.
 */
export async function marketAnalysis(db: DB, market: MarketDataProvider | null, instrumentId: string, resolution: AnalysisResolution) {
  const [instrument] = await db.select().from(instruments).where(eq(instruments.id, instrumentId));
  if (!instrument) throw notFound('unknownInstrument');
  const source = analysisSource(instrument.symbol);
  if (!source) throw badRequest('analysisUnavailable', { symbol: instrument.symbol });
  const [sourceInstrument] = source.via ? await db.select().from(instruments).where(eq(instruments.symbol, source.via)) : [instrument];
  if (!sourceInstrument) throw badRequest('analysisUnavailable', { symbol: instrument.symbol });

  let fetchError: string | null = null;
  if (market) {
    for (const res of new Set<AnalysisResolution>([resolution, 'D1'])) {
      if ((fetched.get(`${sourceInstrument.id}:${res}`) ?? 0) > Date.now() - ON_DEMAND_MS[res]) continue;
      try {
        await syncCandles(db, market, sourceInstrument.id, source.epic, res);
      } catch (err) {
        // Show what is stored; the client says the data may be behind.
        fetchError = (err as Error).message;
      }
    }
  }

  const offset = source.via ? await basisOffset(db, instrument.symbol) : null;
  const by = offset?.difference ?? 0;
  const candles = (await loadCandles(db, sourceInstrument.id, resolution, WINDOW)).map((c) => (by ? shift(c, by) : c));
  // Enough days for the previous month's range and this month's open.
  const daily = (await loadCandles(db, sourceInstrument.id, 'D1', 70)).map((c) => (by ? shift(c, by) : c));
  const atrValue = atr(candles);
  const swings = findSwings(candles, STRENGTH[resolution]);
  const equal = atrValue ? findEqualLevels(candles, swings, atrValue * EQUAL_ATR_SHARE) : [];
  const chartFrom = candles.at(-CHART)?.time ?? candles[0]?.time ?? '';
  const sentiment = (await sentimentFor(market, [source.epic])).get(source.epic) ?? null;
  const last = candles.at(-1) ?? null;

  return {
    instrument: { id: instrument.id, symbol: instrument.symbol, unitSize: instrument.unitSize, measureUnit: instrument.measureUnit },
    source: { epic: source.epic, via: source.via, provider: 'capital' as const },
    /** Futures: the futures − CFD difference the CFD prices were shifted by (null: not measured yet, prices are the CFD's). */
    offset: source.via ? (offset ? { difference: offset.difference, measuredAt: offset.measuredAt } : null) : undefined,
    resolution,
    available: market != null || candles.length > 0,
    fetchError,
    lastPrice: last ? round(last.close) : null,
    lastCandleAt: last?.time ?? null,
    atr: atrValue,
    candles: candles.filter((c) => c.time >= chartFrom),
    /** Swings in the chart's window; the unbroken ones are the levels still in play. */
    swings: swings.filter((s) => s.time >= chartFrom),
    equalLevels: equal.filter((l) => l.touches.at(-1)!.time >= chartFrom),
    dayLevels: dayLevels(daily),
    sentiment: sentiment && { long: sentiment.long, short: sentiment.short, at: new Date(sentiment.at) },
  };
}

/**
 * One line per instrument for the analysis overview (the user's favourites with data, or every such
 * instrument): last price, the nearest unswept equal highs above and lows below, and sentiment.
 */
export async function analysisOverview(db: DB, market: MarketDataProvider | null, user: CurrentUser) {
  const favourites = await db
    .select({ id: instruments.id, symbol: instruments.symbol })
    .from(favoriteInstruments)
    .innerJoin(instruments, eq(instruments.id, favoriteInstruments.instrumentId))
    .where(eq(favoriteInstruments.userId, user.id));
  const all = await db.select({ id: instruments.id, symbol: instruments.symbol }).from(instruments).where(eq(instruments.active, true));
  const pick = (favourites.length ? favourites : all).filter((i) => analysisSource(i.symbol));
  const items = [];
  for (const i of pick) {
    try {
      const a = await marketAnalysis(db, market, i.id, 'H4');
      const open = a.equalLevels.filter((l) => !l.swept);
      const price = a.lastPrice ?? 0;
      items.push({
        instrumentId: i.id,
        symbol: i.symbol,
        via: a.source.via,
        lastPrice: a.lastPrice,
        dayOpen: a.dayLevels.todayOpen,
        equalHighsAbove: open.filter((l) => l.kind === 'highs' && l.bottom >= price).sort((x, y) => x.price - y.price)[0] ?? null,
        equalLowsBelow: open.filter((l) => l.kind === 'lows' && l.top <= price).sort((x, y) => y.price - x.price)[0] ?? null,
        sentiment: a.sentiment,
      });
    } catch {
      // An instrument without data is left out of the overview.
    }
  }
  return { items };
}
