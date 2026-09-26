import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { seed } from '../src/db/seed-data.ts';
import { loadEnv } from '../src/env.ts';
import type { FxProvider } from '../src/services/fx.ts';

/** Offline stand-in for the ECB feed; counts calls to check caching. */
const rates: Record<string, number> = { 'USD/EUR': 0.85, 'USD/GBP': 0.75, 'USD/PLN': 3.66 };
const fx: FxProvider & { calls: number; down: boolean } = {
  calls: 0,
  down: false,
  async fetchRate(date, base, quote) {
    fx.calls++;
    if (fx.down) throw new Error('offline');
    return { rate: rates[`${base}/${quote}`]!, rateDate: date };
  },
};

let app: App;
let database: Database;
let uploadDir: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), 'trading-uploads-'));
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://', UPLOAD_DIR: uploadDir });
  database = createDatabase(env.DATABASE_URL);
  await database.migrate();
  await seed(database.db, env.DEV_USER_EMAIL);
  app = await buildApp({ db: database.db, env, fx, logger: false });

  const instruments = (await app.inject({ url: '/instruments' })).json<{ id: string; symbol: string }[]>();
  for (const i of instruments) ids[i.symbol] = i.id;
});

afterAll(async () => {
  await app.close();
  await database.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers });

describe('reference data', () => {
  it('seeds instruments, emotions and the admin user', async () => {
    expect(Object.keys(ids).sort()).toEqual(
      ['ES1', 'GC1', 'MES1', 'MGC1', 'MNQ1', 'MYM1', 'NQ1', 'US100', 'US30', 'US500', 'XAUUSD', 'YM1'],
    );
    const emotions = (await app.inject({ url: '/emotions' })).json();
    expect(emotions[0]).toEqual({ key: 'calm', label: 'Spokój' });
    const me = (await app.inject({ url: '/me' })).json();
    expect(me.role).toBe('admin');
    expect(me.settings).toMatchObject({ accountCurrency: 'USD', timezone: 'Europe/Warsaw' });
  });

  it('validates settings', async () => {
    const bad = await app.inject({ method: 'PATCH', url: '/me', payload: { accentColor: 'red', timezone: 'Mars/Base' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues).toHaveLength(2);
    const ok = await app.inject({ method: 'PATCH', url: '/me', payload: { accentColor: '#FF5A1F', maxTradesPerDay: 2 } });
    expect(ok.json().settings).toMatchObject({ accentColor: '#FF5A1F', maxTradesPerDay: 2 });
  });
});

describe('trading journal', () => {
  it('computes pips, ticks and R, and numbers trades per day across instruments', async () => {
    const first = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'short',
      openedAt: '2025-09-26T08:15:00+02:00',
      entryPrice: 4406.5,
      exitPrice: 4390,
      stopLoss: 4414,
      takeProfit: 4390,
      positionSize: 0.5,
      emotionKeys: ['calm', 'confident'],
    });
    expect(first.statusCode).toBe(201);
    const t1 = first.json().trade;
    expect(t1).toMatchObject({
      dayLabel: '1/26.09.2025 – SHORT',
      resultUnits: 165,
      pnlAccount: 825,
      rMultiple: 2.2,
      status: 'closed',
      instrument: { symbol: 'XAUUSD', measureUnit: 'pip', market: 'cfd' },
      emotionKeys: ['calm', 'confident'],
    });

    // Entered later, but opened earlier that day: it becomes trade #1 and the gold trade #2.
    const earlier = await post('/trades', {
      instrumentId: ids.NQ1,
      direction: 'long',
      openedAt: '2025-09-26T07:30:00+02:00',
      entryPrice: 21000,
      exitPrice: 20990,
      stopLoss: 20990,
      positionSize: 1,
      fees: 4.5,
      emotionKeys: ['fomo'],
    });
    expect(earlier.json().trade).toMatchObject({ dayLabel: '1/26.09.2025 – LONG', resultUnits: -40, pnlAccount: -204.5 });
    ids.goldTrade = t1.id;

    const third = await post('/trades', {
      instrumentId: ids.YM1,
      direction: 'long',
      openedAt: '2025-09-26T15:40:00+02:00',
      entryPrice: 46000,
      stopLoss: 45980,
      takeProfit: 46060,
      positionSize: 1,
    });
    // maxTradesPerDay is 2, so the third trade of the day is flagged.
    expect(third.json().trade).toMatchObject({ dayLabel: '3/26.09.2025 – LONG', status: 'open', overDailyLimit: true, plannedRR: 3 });

    const gold = (await app.inject({ url: `/trades/${t1.id}` })).json();
    expect(gold.dayLabel).toBe('2/26.09.2025 – SHORT');
  });

  it('filters the list without changing daily numbers', async () => {
    const res = await app.inject({ url: `/trades?instrumentId=${ids.XAUUSD}` });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].dayLabel).toBe('2/26.09.2025 – SHORT');

    const bySize = (await app.inject({ url: '/trades?sizeMin=1&status=closed' })).json();
    expect(bySize.items.map((t: { instrument: { symbol: string } }) => t.instrument.symbol)).toEqual(['NQ1']);
  });

  it('warns about a stop loss on the wrong side and recomputes on update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/trades/${ids.goldTrade}`,
      payload: { exitPrice: 4384, stopLoss: 4400 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual(['SL powinien być powyżej ceny wejścia']);
    expect(res.json().trade.resultUnits).toBe(225);
    await app.inject({ method: 'PATCH', url: `/trades/${ids.goldTrade}`, payload: { stopLoss: 4414 } });
  });

  it('leaves money empty when the account currency differs and no rate is given', async () => {
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'chf' } });
    const res = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-09-27T10:00:00+02:00',
      entryPrice: 4000,
      exitPrice: 4001,
      positionSize: 1,
    });
    expect(res.json().trade).toMatchObject({ pnlQuote: 100, pnlAccount: null, accountCurrency: 'CHF' });
    expect(res.json().warnings).toEqual([
      'Brak automatycznego kursu USD/CHF. Wpisz go ręcznie, aby policzyć wynik w walucie konta',
    ]);
    const withRate = await app.inject({ method: 'PATCH', url: `/trades/${res.json().trade.id}`, payload: { fxRate: 3.7 } });
    expect(withRate.json().trade.pnlAccount).toBe(370);
    await app.inject({ method: 'DELETE', url: `/trades/${res.json().trade.id}` });
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'USD' } });
  });

  it('returns stats for closed trades', async () => {
    const stats = (await app.inject({ url: '/trades/stats' })).json();
    expect(stats.summary).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50, pnl: 920.5, profitFactor: 5.5 });
    expect(stats.equityCurve).toEqual([{ date: '2025-09-26', pnl: 920.5, cumulative: 920.5 }]);
    expect(stats.byDayIndex.map((d: { key: string }) => d.key)).toEqual(['1', '2']);
    expect(stats.byEmotion.find((e: { key: string }) => e.key === 'fomo')).toMatchObject({ label: 'FOMO', winRate: 0 });
  });

  it('stores and deletes screenshots', async () => {
    const boundary = 'testboundary';
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chart.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: `/trades/${ids.goldTrade}/screenshots`,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(upload.statusCode).toBe(201);
    const shot = upload.json();
    expect((await app.inject({ url: shot.url })).statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/trades/${ids.goldTrade}/screenshots/${shot.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ url: shot.url })).statusCode).toBe(404);
  });
});

describe('CFD, futures, spreads and FX', () => {
  it('counts points on index CFDs and ticks on micro futures', async () => {
    const cfd = await post('/trades', {
      instrumentId: ids.US100,
      direction: 'long',
      openedAt: '2025-10-01T15:31:00+02:00',
      entryPrice: 24000,
      exitPrice: 24025.5,
      positionSize: 2,
    });
    expect(cfd.json().trade).toMatchObject({ resultUnits: 25.5, pnlAccount: 51, instrument: { measureUnit: 'point' } });

    const micro = await post('/trades', {
      instrumentId: ids.MNQ1,
      direction: 'short',
      openedAt: '2025-10-01T16:00:00+02:00',
      entryPrice: 24000,
      exitPrice: 23990,
      positionSize: 3,
    });
    // 10 points = 40 ticks × 0.50 USD × 3 contracts
    expect(micro.json().trade).toMatchObject({ resultUnits: 40, pnlAccount: 60, instrument: { market: 'futures' } });
    for (const t of [cfd, micro]) await app.inject({ method: 'DELETE', url: `/trades/${t.json().trade.id}` });
  });

  it('asks for the CFD spread once per day and suggests the previous one', async () => {
    const url = (date: string) => `/spreads/${ids.XAUUSD}/${date}`;
    expect((await app.inject({ url: url('2025-10-02') })).json()).toMatchObject({ spread: null, askUser: true, suggestion: null });

    await app.inject({ method: 'PUT', url: url('2025-10-02'), payload: { spread: 2.5 } });
    expect((await app.inject({ url: url('2025-10-03') })).json()).toMatchObject({
      spread: null,
      askUser: true,
      suggestion: { spread: 2.5, date: '2025-10-02' },
    });

    // Futures don't need a spread.
    expect((await app.inject({ url: `/spreads/${ids.NQ1}/2025-10-03` })).json().askUser).toBe(false);

    const trade = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-10-02T10:00:00+02:00',
      entryPrice: 4000,
      exitPrice: 4002,
      positionSize: 0.5,
    });
    // 2.5 pips × 10 USD × 0.5 lot; the result itself is unchanged (fills include the spread).
    expect(trade.json().trade).toMatchObject({ spreadUnits: 2.5, spreadCost: 12.5, pnlAccount: 100 });
    await app.inject({ method: 'DELETE', url: `/trades/${trade.json().trade.id}` });
  });

  it('converts to EUR with the rate from the closing day, caching past days', async () => {
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'EUR' } });
    const before = fx.calls;
    const body = {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-10-06T10:00:00+02:00',
      closedAt: '2025-10-06T11:00:00+02:00',
      entryPrice: 4000,
      exitPrice: 4001,
      positionSize: 1,
    };
    const first = (await post('/trades', body)).json().trade;
    expect(first).toMatchObject({ pnlQuote: 100, pnlAccount: 85, fxRate: 0.85, fxRateSource: 'auto' });
    const second = (await post('/trades', body)).json().trade;
    expect(second.pnlAccount).toBe(85);
    expect(fx.calls - before).toBe(1);

    // A manual rate is kept when other fields change; null switches back to automatic.
    await app.inject({ method: 'PATCH', url: `/trades/${first.id}`, payload: { fxRate: 0.9 } });
    const edited = (await app.inject({ method: 'PATCH', url: `/trades/${first.id}`, payload: { exitPrice: 4002 } })).json();
    expect(edited.trade).toMatchObject({ pnlAccount: 180, fxRateSource: 'manual' });
    const reset = (await app.inject({ method: 'PATCH', url: `/trades/${first.id}`, payload: { fxRate: null } })).json();
    expect(reset.trade).toMatchObject({ pnlAccount: 170, fxRateSource: 'auto' });

    for (const t of [first, second]) await app.inject({ method: 'DELETE', url: `/trades/${t.id}` });
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'USD' } });
  });

  it('converts to PLN automatically', async () => {
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'PLN' } });
    const res = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-10-08T10:00:00+02:00',
      entryPrice: 4000,
      exitPrice: 4001,
      positionSize: 1,
    });
    expect(res.json().trade).toMatchObject({ pnlQuote: 100, pnlAccount: 366, fxRateSource: 'auto' });
    await app.inject({ method: 'DELETE', url: `/trades/${res.json().trade.id}` });
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'USD' } });
  });

  it('warns when the rate cannot be fetched', async () => {
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'GBP' } });
    fx.down = true;
    const res = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-10-07T10:00:00+02:00',
      entryPrice: 4000,
      exitPrice: 4001,
      positionSize: 1,
    });
    fx.down = false;
    expect(res.json().trade.pnlAccount).toBeNull();
    expect(res.json().warnings[0]).toMatch(/Nie udało się pobrać kursu USD\/GBP/);
    await app.inject({ method: 'DELETE', url: `/trades/${res.json().trade.id}` });
    await app.inject({ method: 'PATCH', url: '/me', payload: { accountCurrency: 'USD' } });
  });
});

describe('educator signals', () => {
  it('parses a pasted signal and matches the instrument', async () => {
    const res = await post('/signals/parse', { text: 'XAUUSD - SELL\nIN: 4406.50\nSL: 4414\nTP1: 4390\nTP2:4384' });
    expect(res.json()).toMatchObject({
      ok: true,
      instrument: { symbol: 'XAUUSD' },
      signal: { direction: 'short', takeProfits: [4390, 4384] },
    });
  });

  it('maps broker aliases to stored symbols', async () => {
    const res = (await post('/signals/parse', { text: 'NAS100 BUY\nIN: 24000\nSL: 23950\nTP: 24100' })).json();
    expect(res).toMatchObject({ signal: { symbol: 'US100' }, instrument: { symbol: 'US100' } });
  });

  it('lets educators publish signals and rejects prices on the wrong side', async () => {
    const educator = (await post('/educators', { displayName: 'Jan Edukator' })).json();
    ids.educator = educator.id;

    const res = await post(
      '/signals',
      { instrumentId: ids.XAUUSD, direction: 'short', entryPrice: 4406.5, stopLoss: 4414, takeProfits: [4390, 4384] },
      { 'x-user-id': educator.id },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      educator: { displayName: 'Jan Edukator' },
      takeProfits: [{ level: 1, price: 4390 }, { level: 2, price: 4384 }],
    });
    ids.signal = res.json().id;

    const wrongSide = await post('/signals', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      entryPrice: 4406.5,
      stopLoss: 4414,
      takeProfits: [4420],
      educatorId: educator.id,
    });
    expect(wrongSide.statusCode).toBe(400);
  });

  it('links a trade to a signal and its educator', async () => {
    const res = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'short',
      openedAt: '2025-09-28T09:00:00+02:00',
      entryPrice: 4406.5,
      positionSize: 0.1,
      signalId: ids.signal,
    });
    expect(res.json().trade).toMatchObject({ source: 'educator', educatorId: ids.educator, signalId: ids.signal });

    const missingEducator = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'short',
      openedAt: '2025-09-28T09:00:00+02:00',
      entryPrice: 4406.5,
      positionSize: 0.1,
      source: 'educator',
    });
    expect(missingEducator.statusCode).toBe(400);
  });
});

describe('daily analysis', () => {
  it('keeps levels valid for a date range', async () => {
    await post('/levels', { instrumentId: ids.XAUUSD, price: 4420, type: 'equal_highs', timeframe: 'H4', validFrom: '2025-09-25' });
    await post('/levels', {
      instrumentId: ids.XAUUSD,
      price: 4380,
      type: 'support',
      timeframe: 'M15',
      validFrom: '2025-09-26',
      validUntil: '2025-09-26',
    });
    const onDay = (await app.inject({ url: `/levels?instrumentId=${ids.XAUUSD}&date=2025-09-26` })).json();
    expect(onDay.map((l: { price: number }) => l.price)).toEqual([4380, 4420]);
    const nextDay = (await app.inject({ url: `/levels?instrumentId=${ids.XAUUSD}&date=2025-09-27` })).json();
    expect(nextDay.map((l: { price: number }) => l.price)).toEqual([4420]);
  });

  it('creates one checklist per instrument and day with default items and HTF levels', async () => {
    const url = `/checklists/${ids.XAUUSD}/2025-09-26`;
    const checklist = (await app.inject({ url })).json();
    expect(checklist.items).toHaveLength(5);
    expect(checklist.htfLevels.map((l: { price: number }) => l.price)).toEqual([4420]);
    expect(checklist.events).toEqual([]);

    const updated = (await app.inject({ method: 'PATCH', url, payload: { bias: 'bearish' } })).json();
    expect(updated).toMatchObject({ id: checklist.id, bias: 'bearish' });

    const toggled = await app.inject({ method: 'PATCH', url: `/checklist-items/${checklist.items[0].id}`, payload: { checked: true } });
    expect(toggled.json().checked).toBe(true);

    const other = (await app.inject({ url: `/checklists/${ids.NQ1}/2025-09-26` })).json();
    expect(other.id).not.toBe(checklist.id);
  });
});
