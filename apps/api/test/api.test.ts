import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { seed } from '../src/db/seed-data.ts';
import { loadEnv } from '../src/env.ts';
import type { QuoteProvider, QuoteSource } from '../src/services/basis.ts';
import type { CalendarSource, FfEvent } from '../src/services/calendar.ts';
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

/** Offline quotes keyed by source symbol; tests set prices and quote times. */
const quoteBook = new Map<string, { price: number; time: Date }>();
const quotes: QuoteProvider = {
  async fetchQuote({ symbol }: QuoteSource) {
    const quote = quoteBook.get(symbol);
    if (!quote) throw new Error(`no quote for ${symbol}`);
    return quote;
  },
};

/** Offline Forex Factory week; tests replace it to simulate feed updates. */
let ffWeek: FfEvent[] = [];
const calendar: CalendarSource = { fetchWeek: async () => ffWeek };

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
  app = await buildApp({ db: database.db, env, fx, quotes, calendar, logger: false });

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

describe('CFD/futures difference measurements', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const setQuotes = (gold: [number, number], index: [number, number], age = { cfd: 1, futures: 2 }) => {
    quoteBook.set('XAU', { price: gold[0], time: minutesAgo(age.cfd) });
    quoteBook.set('GC=F', { price: gold[1], time: minutesAgo(age.futures) });
    for (const [cfd, fut] of [['^NDX', 'NQ=F'], ['^GSPC', 'ES=F'], ['^DJI', 'YM=F']] as const) {
      quoteBook.set(cfd, { price: index[0], time: minutesAgo(age.cfd) });
      quoteBook.set(fut, { price: index[1], time: minutesAgo(age.futures) });
    }
  };
  const gold = async () =>
    (await app.inject({ url: '/basis' })).json().find((p: { pairKey: string }) => p.pairKey === 'gold');

  it('records live measurements and flags a move beyond the threshold', async () => {
    setQuotes([4400, 4435], [30_000, 30_280]);
    const first = (await app.inject({ method: 'POST', url: '/basis/refresh' })).json();
    expect(first.results.every((r: { status: string }) => r.status === 'saved')).toBe(true);
    expect(await gold()).toMatchObject({ latest: { difference: 35, live: true }, change: null, alert: false });

    // +1.5 pt: below the 2 pt gold threshold.
    setQuotes([4410, 4446.5], [30_000, 30_285]);
    await app.inject({ method: 'POST', url: '/basis/refresh' });
    expect(await gold()).toMatchObject({ change: 1.5, alert: false });

    // +2.5 pt: alert.
    setQuotes([4420, 4459], [30_000, 30_300]);
    await app.inject({ method: 'POST', url: '/basis/refresh' });
    expect(await gold()).toMatchObject({ latest: { difference: 39 }, change: 2.5, alert: true, alertPoints: 2 });
  });

  it('marks quotes from a closed market as not live and skips repeats', async () => {
    // Futures last traded 3 hours ago (market closed): recorded, but not live.
    setQuotes([4300, 4330], [30_000, 30_300], { cfd: 1, futures: 180 });
    await app.inject({ method: 'POST', url: '/basis/refresh' });
    const closed = await gold();
    expect(closed.latest).toMatchObject({ difference: 30, live: false });
    expect(closed.latestLive.difference).toBe(39);

    // Same futures trade again: nothing new to record.
    const again = (await app.inject({ method: 'POST', url: '/basis/refresh' })).json();
    expect(again.results.find((r: { pairKey: string }) => r.pairKey === 'gold').status).toBe('unchanged');
  });

  it('reports a failed quote without breaking other pairs', async () => {
    quoteBook.delete('GC=F');
    const res = (await app.inject({ method: 'POST', url: '/basis/refresh' })).json();
    expect(res.results.find((r: { pairKey: string }) => r.pairKey === 'gold')).toMatchObject({ status: 'error' });
  });
});

describe('economic calendar', () => {
  const ev = (title: string, country: string, date: string, impact = 'High'): FfEvent => ({
    title,
    country,
    date,
    impact,
    forecast: '0.3%',
    previous: '0.2%',
  });

  it('imports the Forex Factory week with categories and instruments', async () => {
    ffWeek = [
      ev('Core CPI m/m', 'USD', '2025-10-14T08:30:00-04:00'),
      ev('Unemployment Rate', 'GBP', '2025-10-14T02:00:00-04:00', 'Medium'),
      // 23:30 in New York is already the next day in Warsaw.
      ev('FOMC Member Waller Speaks', 'USD', '2025-10-14T19:30:00-04:00', 'Low'),
      ev('Bank Holiday', 'JPY', '2025-10-13T19:00:00-04:00', 'Holiday'),
    ];
    const refresh = (await app.inject({ method: 'POST', url: '/calendar/refresh' })).json();
    expect(refresh).toMatchObject({ status: 'updated', imported: 4 });

    const day = (await app.inject({ url: '/calendar?from=2025-10-14&to=2025-10-14' })).json();
    expect(day.events.map((e: { title: string }) => e.title)).toEqual(['Bank Holiday', 'Unemployment Rate', 'Core CPI m/m']);
    expect(day.events.find((e: { title: string }) => e.title === 'Core CPI m/m')).toMatchObject({
      impact: 'high',
      category: 'inflation',
      forecast: '0.3%',
      instruments: expect.arrayContaining(['XAUUSD', 'NQ1', 'US100']),
    });
    const next = (await app.inject({ url: '/calendar?from=2025-10-15&to=2025-10-15' })).json();
    expect(next.events[0]).toMatchObject({ title: 'FOMC Member Waller Speaks', category: 'central_bank', localDate: '2025-10-15' });
  });

  it('filters by currency, impact, category and instrument', async () => {
    const q = (params: string) =>
      app.inject({ url: `/calendar?from=2025-10-13&to=2025-10-15&${params}` }).then((r) => r.json().events.map((e: { title: string }) => e.title));
    expect(await q('currencies=GBP,JPY')).toEqual(['Bank Holiday', 'Unemployment Rate']);
    expect(await q('impacts=high')).toEqual(['Core CPI m/m']);
    expect(await q('categories=labor,central_bank')).toEqual(['Unemployment Rate', 'FOMC Member Waller Speaks']);
    // XAUUSD is mapped to USD only.
    expect(await q(`instrumentId=${ids.XAUUSD}`)).toEqual(['Core CPI m/m', 'FOMC Member Waller Speaks']);
    expect((await app.inject({ url: '/calendar?from=2025-10-13&to=2025-10-15&impacts=extreme' })).statusCode).toBe(400);
  });

  it('drops events that disappear from the feed and rate-limits refreshes', async () => {
    expect((await app.inject({ method: 'POST', url: '/calendar/refresh' })).json().status).toBe('recent');

    // The speech moved to another time: the old slot is removed, not duplicated.
    const { importWeek } = await import('../src/services/calendar.ts');
    ffWeek = [ffWeek[0]!, ffWeek[1]!, ev('FOMC Member Waller Speaks', 'USD', '2025-10-14T12:00:00-04:00', 'Low'), ffWeek[3]!];
    await importWeek(database.db, ffWeek);
    const all = (await app.inject({ url: '/calendar?from=2025-10-13&to=2025-10-15' })).json();
    expect(all.events.filter((e: { title: string }) => e.title.includes('Waller'))).toHaveLength(1);
    expect(all.coverage).toMatchObject({ from: '2025-10-14', to: '2025-10-14' });
  });

  it('feeds the pre-session checklist', async () => {
    const checklist = (await app.inject({ url: `/checklists/${ids.XAUUSD}/2025-10-14` })).json();
    expect(checklist.events.map((e: { title: string }) => e.title)).toEqual(['Core CPI m/m', 'FOMC Member Waller Speaks']);
  });
});

describe('trading monitor', () => {
  const trade = (minutesAgo: number, exitPrice: number) =>
    post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      closedAt: new Date(Date.now() - (minutesAgo - 1) * 60_000).toISOString(),
      entryPrice: 4000,
      exitPrice,
      positionSize: 0.1,
    }).then((r) => r.json().trade.id as string);

  it('alerts after three losing trades in a row today', async () => {
    // Without accounts, everything is one group of trades without an account.
    const monitor = async () => (await app.inject({ url: '/trades/monitor' })).json();
    const created = [await trade(40, 3995), await trade(30, 3990)];
    expect((await monitor()).groups).toMatchObject([{ accountId: null, lossCount: 2, alert: false }]);

    created.push(await trade(20, 3998));
    const alerted = await monitor();
    expect(alerted).toMatchObject({ lossMode: 'streak', lossLimit: 3, alert: true });
    expect(alerted.groups[0]).toMatchObject({ lossCount: 3, alert: true, tradesToday: 3, overLimit: true });
    expect(alerted.groups[0].lossLabels).toHaveLength(3);

    // A win resets the streak.
    created.push(await trade(10, 4010));
    expect(await monitor()).toMatchObject({ alert: false, groups: [{ lossCount: 0 }] });

    // Counting every loss of the day, the win no longer resets the count.
    await app.inject({ method: 'PATCH', url: '/me', payload: { lossAlertMode: 'day' } });
    const daily = await monitor();
    expect(daily).toMatchObject({ lossMode: 'day', alert: true, groups: [{ lossCount: 3, alert: true }] });
    expect(daily.groups[0].alertKey).toMatch(/^day:none:/);
    await app.inject({ method: 'PATCH', url: '/me', payload: { lossAlertMode: 'streak' } });
    for (const id of created) await app.inject({ method: 'DELETE', url: `/trades/${id}` });
  });

  it('uses the losing streak threshold from the settings', async () => {
    const me = (await app.inject({ method: 'PATCH', url: '/me', payload: { lossStreakAlert: 2 } })).json();
    expect(me.settings.lossStreakAlert).toBe(2);
    const created = [await trade(40, 3995), await trade(30, 3990)];
    expect((await app.inject({ url: '/trades/monitor' })).json()).toMatchObject({ lossLimit: 2, alert: true, groups: [{ lossCount: 2 }] });
    for (const id of created) await app.inject({ method: 'DELETE', url: `/trades/${id}` });

    const tooHigh = await app.inject({ method: 'PATCH', url: '/me', payload: { lossStreakAlert: 50 } });
    expect(tooHigh.statusCode).toBe(400);
    await app.inject({ method: 'PATCH', url: '/me', payload: { lossStreakAlert: 3 } });
  });

  it('accepts only whole futures contracts', async () => {
    const res = await post('/trades', {
      instrumentId: ids.MGC1,
      direction: 'long',
      openedAt: '2025-10-20T10:00:00+02:00',
      entryPrice: 4000,
      positionSize: 0.5,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pełnymi kontraktami/);
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

describe('language', () => {
  it('answers in English after switching the language', async () => {
    const me = (await app.inject({ method: 'PATCH', url: '/me', payload: { language: 'en' } })).json();
    expect(me.settings.language).toBe('en');

    const emotions = (await app.inject({ url: '/emotions' })).json();
    expect(emotions[0]).toEqual({ key: 'calm', label: 'Calm' });

    const bad = await app.inject({ method: 'PATCH', url: '/me', payload: { accentColor: 'red' } });
    expect(bad.json()).toMatchObject({ error: 'Invalid data', issues: [{ message: 'Colour in #RRGGBB format' }] });

    const unknown = await post('/trades', {
      instrumentId: '00000000-0000-4000-8000-000000000000',
      direction: 'long',
      openedAt: '2025-09-26T08:00:00Z',
      entryPrice: 1,
      positionSize: 1,
    });
    expect(unknown.json().error).toBe('Unknown instrument');

    const warned = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2025-09-20T08:00:00Z',
      entryPrice: 4400,
      stopLoss: 4410,
      positionSize: 0.1,
    });
    expect(warned.json().warnings).toEqual(['SL should be below the entry price']);
    await app.inject({ method: 'DELETE', url: `/trades/${warned.json().trade.id}` });

    const stats = (await app.inject({ url: '/trades/stats' })).json();
    expect(stats.bySource.map((b: { key: string }) => b.key)).toContain('Own analysis');
    expect(stats.summary).not.toHaveProperty('spreadCost');

    await app.inject({ method: 'PATCH', url: '/me', payload: { language: 'pl' } });
  });
});

/** multipart/form-data body with text fields first and one file. */
function multipart(fields: Record<string, string>, file: { name: string; content: Buffer }) {
  const boundary = 'importboundary';
  const parts = Object.entries(fields).map(
    ([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const payload = Buffer.concat([
    Buffer.from(parts.join('')),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('MT5 import', () => {
  const report = readFileSync(new URL('../../../packages/shared/test/fixtures/mt5-report.html', import.meta.url));
  // MT5 writes UTF-16 LE with a BOM.
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(report.toString('utf8'), 'utf16le')]);
  let trader: Record<string, string>;

  const importFile = (fields: Record<string, string>, content = utf16, name = 'ReportHistory-12345678.html') => {
    const body = multipart(fields, { name, content });
    return app.inject({ method: 'POST', url: '/trades/import/mt5', payload: body.payload, headers: { ...body.headers, ...trader } });
  };

  beforeAll(async () => {
    const user = (await post('/educators', { displayName: 'Importer' })).json();
    trader = { 'x-user-id': user.id };
  });

  it('previews positions without saving them', async () => {
    const res = await importFile({});
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview).toMatchObject({
      account: '12345678',
      currency: 'USD',
      summary: { total: 3, ready: 2, unknownSymbol: 1, imported: 0 },
      unknownSymbols: ['GER40'],
    });
    expect(preview.positions[0]).toMatchObject({
      instrumentSymbol: 'XAUUSD',
      direction: 'long',
      openedAt: '2026-09-25T07:15:23.000Z',
      resultUnits: 190,
      status: 'ready',
    });
    expect(preview.positions[1]).toMatchObject({ symbol: 'US100.cash', instrumentSymbol: 'US100', resultUnits: -32 });
    const list = (await app.inject({ url: '/trades', headers: trader })).json();
    expect(list.total).toBe(0);
  });

  it('imports with a symbol mapping and skips positions imported before', async () => {
    const res = await importFile({ commit: 'true', symbolMap: JSON.stringify({ GER40: ids.US30 }) });
    expect(res.json().summary).toMatchObject({ imported: 3, ready: 0 });

    const list = (await app.inject({ url: '/trades', headers: trader })).json();
    expect(list.total).toBe(3);
    const gold = list.items.find((t: { instrument: { symbol: string } }) => t.instrument.symbol === 'XAUUSD');
    expect(gold).toMatchObject({
      externalId: 'mt5:12345678:50001',
      positionSize: 0.1,
      stopLoss: 4360,
      fees: 0.7,
      pnlAccount: 189.3,
      closedAt: '2026-09-25T08:02:10.000Z',
    });
    expect(gold.notes).toContain('#50001');

    const again = (await importFile({ commit: 'true', symbolMap: JSON.stringify({ GER40: ids.US30 }) })).json();
    expect(again.summary).toMatchObject({ imported: 0, duplicate: 3 });
    expect((await app.inject({ url: '/trades', headers: trader })).json().total).toBe(3);
  });

  /** A one-position Open XML report (account 99887766, XAUUSD sell). */
  const xlsxReport = () => {
    const shared = ['Account:', '99887766 (USD, Broker, real)', 'XAUUSD', 'sell'];
    const cell = (ref: string, value: string | number) =>
      typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="s"><v>${shared.indexOf(value)}</v></c>`;
    const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">${cell('A1', 'Account:')}${cell('D1', '99887766 (USD, Broker, real)')}</row>
      <row r="2">${inline('A2', '2026.09.24 09:00:00')}<c r="B2"><v>777</v></c>${cell('C2', 'XAUUSD')}${cell('D2', 'sell')}${cell('E2', 0.2)}${cell('F2', 4400)}<c r="G2"/><c r="H2"/>${inline('I2', '2026.09.24 10:00:00')}${cell('J2', 4390)}${cell('K2', 0)}${cell('L2', 0)}${cell('M2', 200)}</row>
    </sheetData></worksheet>`;
    const sst = `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
    return Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet), 'xl/sharedStrings.xml': strToU8(sst) }));
  };

  it('reads the Open XML (.xlsx) report', async () => {
    const xlsx = xlsxReport();
    const preview = (await importFile({ timezone: 'UTC' }, xlsx, 'ReportHistory.xlsx')).json();
    expect(preview).toMatchObject({ account: '99887766', summary: { total: 1, ready: 1 } });
    expect(preview.positions[0]).toMatchObject({ direction: 'short', volume: 0.2, openedAt: '2026-09-24T09:00:00.000Z', resultUnits: 100 });
  });

  it('assigns imported trades to an account and flags other markets', async () => {
    const futures = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Apex', type: 'prop', market: 'futures', size: 50_000, maxDrawdownPct: 5 },
        headers: trader,
      })
    ).json();
    const preview = (await importFile({ accountId: futures.id, timezone: 'UTC' }, xlsxReport(), 'ReportHistory.xlsx')).json();
    expect(preview.positions[0]).toMatchObject({ instrumentSymbol: 'XAUUSD', status: 'wrongMarket' });
    expect(preview.summary).toMatchObject({ ready: 0, wrongMarket: 1 });
  });

  it('rejects files that are not MT5 reports', async () => {
    const res = await importFile({}, Buffer.from('just some text'), 'notes.txt');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Nie rozpoznano pliku/);
    const noFile = await app.inject({
      method: 'POST',
      url: '/trades/import/mt5',
      ...multipart({ timezone: 'Mars/Base' }, { name: 'r.html', content: utf16 }),
    });
    expect(noFile.statusCode).toBe(400);
  });
});

describe('trading accounts', () => {
  let trader: Record<string, string>;
  let prop: { id: string };
  let live: { id: string };
  const as = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: trader });
  const stats = async (query = '') => (await as('GET', `/trades/stats${query}`)).json();
  // XAUUSD: 1 lot, 1 pip (0.1) = 10 USD.
  const gold = (day: string, exitPrice: number | null, extra: object = {}) =>
    as('POST', '/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: `${day}T08:00:00Z`,
      closedAt: exitPrice == null ? null : `${day}T09:00:00Z`,
      entryPrice: 4000,
      exitPrice,
      positionSize: 1,
      ...extra,
    });

  beforeAll(async () => {
    const user = (await post('/educators', { displayName: 'Account trader' })).json();
    trader = { 'x-user-id': user.id };
  });

  it('validates prop accounts: market and maximum drawdown are required', async () => {
    const noMarket = await as('POST', '/accounts', { name: 'FTMO', type: 'prop', size: 10_000, maxDrawdownPct: 10 });
    expect(noMarket.statusCode).toBe(400);
    expect(noMarket.json().issues[0].message).toBe('Wybierz, czy konto prop jest na CFD, czy na futures');
    expect((await as('POST', '/accounts', { name: 'FTMO', type: 'prop', market: 'cfd', size: 10_000 })).statusCode).toBe(400);
  });

  it('keeps several accounts, each with its own balance', async () => {
    prop = (await as('POST', '/accounts', { name: 'FTMO 10k', type: 'prop', market: 'cfd', size: 10_000, maxDrawdownPct: 10, profitTargetPct: 8 })).json();
    live = (await as('POST', '/accounts', { name: 'Live', type: 'live', size: 5_000, leverage: 100 })).json();

    await gold('2026-09-01', 4005, { accountId: prop.id }); // +500
    await gold('2026-09-02', 3997, { accountId: prop.id }); // −300
    await gold('2026-09-03', 3996, { accountId: prop.id }); // −400
    await gold('2026-09-03', 4002, { accountId: live.id }); // +200
    await gold('2026-09-04', 4001); // +100, no account

    const accounts = (await as('GET', '/accounts')).json();
    expect(accounts.map((a: { name: string; balance: number }) => [a.name, a.balance])).toEqual([
      ['FTMO 10k', 9800],
      ['Live', 5200],
    ]);
    expect(accounts[0]).toMatchObject({
      currentDrawdown: 700,
      prop: { floor: 9000, used: 200, remaining: 800, usedPct: 20, breached: false, target: { balance: 10_800, remaining: 1000, reached: false } },
    });
    expect(accounts[1]).toMatchObject({ type: 'live', leverage: 100, prop: null });
  });

  it('shows the journal and stats per account, without an account, or all together', async () => {
    expect((await stats()).summary.pnl).toBe(100);
    expect((await stats()).account).toBeNull();

    const one = await stats(`?account=${prop.id}`);
    expect(one.summary).toMatchObject({ trades: 3, pnl: -200, returnPct: -2, maxDrawdown: 700, maxDrawdownPct: 7 });
    expect(one.account).toMatchObject({ id: prop.id, balance: 9800 });
    expect(one.balanceCurve).toEqual({
      start: 10_000,
      points: [
        { date: '2026-09-01', balance: 10_500 },
        { date: '2026-09-02', balance: 10_200 },
        { date: '2026-09-03', balance: 9800 },
      ],
    });

    expect((await stats('?account=none')).summary).toMatchObject({ trades: 1, pnl: 100 });
    expect((await as('GET', `/trades?account=${live.id}`)).json().total).toBe(1);
    expect((await as('GET', '/trades?account=none')).json().total).toBe(1);
  });

  it('prices the risk against the balance of the trade account', async () => {
    const open = (await gold('2026-09-05', null, { accountId: prop.id, stopLoss: 3995, positionSize: 0.5 })).json().trade;
    // 50 pips × 10 × 0.5 = 250 against a 9 800 balance.
    expect(open).toMatchObject({ riskAccount: 250, riskPct: 2.55 });
    const loose = (await gold('2026-09-05', null, { stopLoss: 3995, positionSize: 0.5 })).json().trade;
    expect(loose).toMatchObject({ riskAccount: 250, riskPct: null });
  });

  it('refuses trades from another market on a prop account', async () => {
    const res = await as('POST', '/trades', {
      instrumentId: ids.NQ1,
      direction: 'long',
      openedAt: '2026-09-05T08:00:00Z',
      entryPrice: 19_800,
      positionSize: 1,
      accountId: prop.id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Konto FTMO 10k jest na CFD, a NQ1 to inny rynek');
  });

  it('runs the trading monitor per account', async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const loss = (minutes: number, accountId?: string) =>
      as('POST', '/trades', {
        instrumentId: ids.XAUUSD,
        direction: 'long',
        openedAt: ago(minutes),
        closedAt: ago(minutes - 1),
        entryPrice: 4000,
        exitPrice: 3999,
        positionSize: 0.1,
        accountId,
      });
    await loss(30, prop.id);
    await loss(20, prop.id);
    await loss(10);
    await as('PATCH', '/me', { lossStreakAlert: 2 });
    const monitor = (await as('GET', '/trades/monitor')).json();
    expect(monitor.groups.map((g: { name: string | null; tradesToday: number; lossCount: number; alert: boolean }) => [g.name, g.tradesToday, g.lossCount, g.alert])).toEqual([
      ['FTMO 10k', 2, 2, true],
      ['Live', 0, 0, false],
      [null, 1, 1, false],
    ]);
    expect(monitor.alert).toBe(true);
    await as('PATCH', '/me', { lossStreakAlert: 3 });
  });

  it('trails an end-of-day drawdown from the best closing balance, up to the start', async () => {
    // EOD balances of the prop account: 10 500, 10 200, 9 800 (days 1–3); limit 10% = 1 000.
    await as('PATCH', `/accounts/${prop.id}`, { drawdownType: 'eod' });
    const trailing = (await as('GET', '/accounts')).json()[0].prop;
    // The best close (10 500) minus 1 000 would be 9 500; balance is 9 800 minus today's losses.
    expect(trailing).toMatchObject({ drawdownType: 'eod', highWater: 10_500, floor: 9500 });

    await as('PATCH', `/accounts/${prop.id}`, { maxDrawdownPct: 2 });
    // 10 500 − 200 = 10 300 would be above the start, so the floor stops at 10 000: breached.
    expect((await as('GET', '/accounts')).json()[0].prop).toMatchObject({ floor: 10_000, breached: true });

    await as('PATCH', `/accounts/${prop.id}`, { drawdownType: 'static', maxDrawdownPct: 10 });
    expect((await as('GET', '/accounts')).json()[0].prop).toMatchObject({ drawdownType: 'static', floor: 9000 });
  });

  it('keeps the trades when an account is deleted', async () => {
    expect((await as('DELETE', `/accounts/${live.id}`)).statusCode).toBe(204);
    expect((await as('GET', '/accounts')).json()).toHaveLength(1);
    expect((await as('GET', '/trades?account=none')).json().total).toBe(4);
    expect((await as('GET', `/trades/stats?account=${live.id}`)).statusCode).toBe(404);
  });

  it('does not let another user see or use the accounts', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/accounts/${prop.id}`, payload: { name: 'Mine' } })).statusCode).toBe(404);
    const foreign = await post('/trades', {
      instrumentId: ids.XAUUSD,
      direction: 'long',
      openedAt: '2026-09-05T08:00:00Z',
      entryPrice: 4000,
      positionSize: 0.1,
      accountId: prop.id,
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('leverage', () => {
  it('accepts only the offered leverage on an account', async () => {
    const account = (await post('/accounts', { name: 'CFD', type: 'live', size: 1000 })).json();
    expect((await app.inject({ method: 'PATCH', url: `/accounts/${account.id}`, payload: { leverage: 100 } })).json().leverage).toBe(100);
    const bad = await app.inject({ method: 'PATCH', url: `/accounts/${account.id}`, payload: { leverage: 25 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues[0].message).toMatch(/10, 20, 30/);
    await app.inject({ method: 'DELETE', url: `/accounts/${account.id}` });
  });
});

describe('authentication', () => {
  let authApp: App;
  let authDb: Database;
  const sent: { to: string; subject: string; text: string }[] = [];
  const origin = 'http://localhost:5173';

  /** Keeps the session cookie between requests, like a browser. */
  function browser() {
    let cookie = '';
    return async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
      const res = await authApp.inject({ method, url, payload, headers: { origin, ...(cookie ? { cookie } : {}) } });
      const set = res.headers['set-cookie'];
      const list = Array.isArray(set) ? set : set ? [set] : [];
      for (const c of list) {
        const [pair] = c.split(';');
        const [name, value] = pair!.split('=');
        const others = cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
        cookie = value ? [...others, pair].join('; ') : others.join('; ');
      }
      return res;
    };
  }

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://', UPLOAD_DIR: uploadDir, AUTH_DEV_BYPASS: 'false', REGISTRATION: 'invite' });
    authDb = createDatabase(env.DATABASE_URL);
    await authDb.migrate();
    await seed(authDb.db, env.DEV_USER_EMAIL);
    authApp = await buildApp({ db: authDb.db, env, fx, quotes, calendar, logger: false, mailer: { send: async (m) => void sent.push(m) } });
  });

  afterAll(async () => {
    await authApp.close();
    await authDb.close();
  });

  it('refuses requests without a session and ignores x-user-id', async () => {
    const res = await authApp.inject({ url: '/me', headers: { 'x-user-id': '00000000-0000-4000-8000-000000000000' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Zaloguj się, aby kontynuować');
    expect((await authApp.inject({ url: '/auth-config' })).json()).toEqual({ registration: 'invite', devBypass: false });
  });

  it('lets the seeded admin sign in after a login is set, and invite a user', async () => {
    const { setLogin } = await import('../src/services/credentials.ts');
    await setLogin(authDb.db, { user: 'admin@trading.local', email: 'owner@example.com', password: 'owner-password-1' });

    const admin = browser();
    const bad = await admin('POST', '/auth/sign-in/email', { email: 'owner@example.com', password: 'wrong-password' });
    expect(bad.statusCode).toBe(401);
    expect((await admin('POST', '/auth/sign-in/email', { email: 'owner@example.com', password: 'owner-password-1' })).statusCode).toBe(200);
    const me = (await admin('GET', '/me')).json();
    expect(me).toMatchObject({ email: 'owner@example.com', role: 'admin', authenticated: true });

    const invite = (await admin('POST', '/invites', { role: 'vip' })).json();
    expect(invite.code).toMatch(/^[A-Z2-9]{10}$/);

    const newcomer = browser();
    const without = await newcomer('POST', '/auth/sign-up/email', { name: 'Jan', email: 'jan@example.com', password: 'jan-password-1' });
    expect(without.statusCode).toBe(400);
    expect(without.json().code).toBe('INVALID_INVITE');

    const signUp = await newcomer('POST', '/auth/sign-up/email', {
      name: 'Jan',
      email: 'jan@example.com',
      password: 'jan-password-1',
      inviteCode: invite.code.toLowerCase(),
      language: 'en',
      timezone: 'Europe/London',
    });
    expect(signUp.statusCode).toBe(200);
    expect((await newcomer('GET', '/me')).json()).toMatchObject({
      displayName: 'Jan',
      role: 'vip',
      settings: { language: 'en', timezone: 'Europe/London' },
    });
    // The newcomer sees only their own journal, and cannot manage invites.
    expect((await newcomer('GET', '/trades')).json().total).toBe(0);
    expect((await newcomer('GET', '/invites')).statusCode).toBe(403);

    // An invite works once.
    const again = await browser()('POST', '/auth/sign-up/email', { name: 'Ola', email: 'ola@example.com', password: 'ola-password-1', inviteCode: invite.code });
    expect(again.json().code).toBe('INVALID_INVITE');
    expect((await admin('GET', '/invites')).json()[0]).toMatchObject({ code: invite.code, usedBy: expect.any(String) });

    await newcomer('POST', '/auth/sign-out', {});
    expect((await newcomer('GET', '/me')).statusCode).toBe(401);
  });

  it('resets a forgotten password with the e-mailed link', async () => {
    const user = browser();
    expect((await user('POST', '/auth/request-password-reset', { email: 'jan@example.com', redirectTo: '/nowe-haslo' })).statusCode).toBe(200);
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ to: 'jan@example.com', subject: 'Password reset' });
    const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)![1]!);

    expect((await user('POST', '/auth/reset-password', { token, newPassword: 'jan-new-password' })).statusCode).toBe(200);
    expect((await user('POST', '/auth/sign-in/email', { email: 'jan@example.com', password: 'jan-password-1' })).statusCode).toBe(401);
    expect((await user('POST', '/auth/sign-in/email', { email: 'jan@example.com', password: 'jan-new-password' })).statusCode).toBe(200);
  });
});
