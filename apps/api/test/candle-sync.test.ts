import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { instruments, ohlcCandles } from '../src/db/schema.ts';
import { seed } from '../src/db/seed-data.ts';
import { loadCandles, syncCandles } from '../src/services/market-analysis.ts';
import type { MarketDataProvider } from '../src/services/market-data.ts';

const MINUTE = 60_000;
const now = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/**
 * Minute candles that behave like Capital.com's (seen 2026-11-04): `from` alone reads only a limited
 * stretch and answers 404 when it holds no candle, at most `max` candles come back, a range of 1000
 * periods or more and a `to` past its clock are refused, and a closed stretch with `to` is empty.
 */
function capitalLike(closedFrom: number, reopensAt: number): MarketDataProvider & { calls: number } {
  const provider = {
    calls: 0,
    async fetchCandles(_epic: string, _resolution: string, { from, to, max = 1000 }: { from?: Date; to?: Date; max?: number }) {
      provider.calls++;
      const clock = now();
      if (to && to.getTime() > clock) throw new Error('Capital.com /prices 400');
      if (from && to && to.getTime() - from.getTime() >= 1000 * MINUTE) throw new Error('Capital.com /prices 400');
      const start = from?.getTime() ?? clock - 1000 * MINUTE;
      const end = to?.getTime() ?? Math.min(start + 1100 * MINUTE, clock);
      const out = [];
      for (let t = Math.ceil(start / MINUTE) * MINUTE; t <= end && out.length < max; t += MINUTE) {
        if (t > closedFrom && t < reopensAt) continue;
        out.push({ time: new Date(t).toISOString(), open: 100, high: 101, low: 99, close: 100 });
      }
      if (out.length === 0 && !to) throw new Error('Capital.com /prices 404');
      return out;
    },
  };
  return provider as unknown as MarketDataProvider & { calls: number };
}

describe('syncing candles across a closed market', () => {
  let database: Database;
  let instrumentId = '';

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://' });
    database = createDatabase(env.DATABASE_URL);
    await database.migrate();
    await seed(database.db, env.DEV_USER_EMAIL);
    instrumentId = (await database.db.select({ id: instruments.id }).from(instruments))[0]!.id;
  }, 60_000);

  afterAll(() => database.close());

  const store = async (time: number) => {
    await database.db.delete(ohlcCandles);
    await database.db.insert(ohlcCandles).values({ instrumentId, timeframe: 'M1', ts: new Date(time), open: 100, high: 101, low: 99, close: 100 });
  };

  it('gets past a weekend longer than a stretch and catches up to now in one sync', async () => {
    const closedFrom = now() - 96 * 60 * MINUTE;
    const market = capitalLike(closedFrom, closedFrom + 49 * 60 * MINUTE);
    await store(closedFrom);

    await syncCandles(database.db, market, instrumentId, 'GOLD', 'M1');

    const candles = await loadCandles(database.db, instrumentId, 'M1', 10_000);
    // Everything since the reopening is there, without a hole, and only a little behind the clock.
    expect(candles.length).toBeGreaterThan(47 * 60 - 5);
    expect(now() - Date.parse(candles.at(-1)!.time)).toBeLessThan(20 * MINUTE);
  });

  it('asks only once more while the market is still closed', async () => {
    const closedFrom = now() - 20 * 60 * MINUTE;
    const market = capitalLike(closedFrom, now() + 60 * MINUTE);
    await store(closedFrom);

    expect(await syncCandles(database.db, market, instrumentId, 'GOLD', 'M1')).toBe(0);
    // `from` alone, then two stretches of 960 minutes up to the clock.
    expect(market.calls).toBeLessThanOrEqual(3);
    expect((await loadCandles(database.db, instrumentId, 'M1', 10)).length).toBe(1);
  });

  it('makes one request when the market is open and the candles are recent', async () => {
    const market = capitalLike(0, 0);
    await store(now() - 5 * MINUTE);

    await syncCandles(database.db, market, instrumentId, 'GOLD', 'M1');

    expect(market.calls).toBe(1);
    expect(Date.parse((await loadCandles(database.db, instrumentId, 'M1', 1))[0]!.time)).toBe(now());
  });
});
