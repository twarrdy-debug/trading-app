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
    const created = [await trade(40, 3995), await trade(30, 3990)];
    expect((await app.inject({ url: '/trades/monitor' })).json()).toMatchObject({ lossCount: 2, alert: false });

    created.push(await trade(20, 3998));
    const monitor = (await app.inject({ url: '/trades/monitor' })).json();
    expect(monitor).toMatchObject({ lossMode: 'streak', lossCount: 3, lossLimit: 3, alert: true, tradesToday: 3, overLimit: true });
    expect(monitor.lossLabels).toHaveLength(3);

    // A win resets the streak.
    created.push(await trade(10, 4010));
    expect((await app.inject({ url: '/trades/monitor' })).json()).toMatchObject({ lossCount: 0, alert: false });

    // Counting every loss of the day, the win no longer resets the count.
    await app.inject({ method: 'PATCH', url: '/me', payload: { lossAlertMode: 'day' } });
    const daily = (await app.inject({ url: '/trades/monitor' })).json();
    expect(daily).toMatchObject({ lossMode: 'day', lossCount: 3, alert: true });
    expect(daily.alertKey).toMatch(/^day:/);
    await app.inject({ method: 'PATCH', url: '/me', payload: { lossAlertMode: 'streak' } });
    for (const id of created) await app.inject({ method: 'DELETE', url: `/trades/${id}` });
  });

  it('uses the losing streak threshold from the settings', async () => {
    const me = (await app.inject({ method: 'PATCH', url: '/me', payload: { lossStreakAlert: 2 } })).json();
    expect(me.settings.lossStreakAlert).toBe(2);
    const created = [await trade(40, 3995), await trade(30, 3990)];
    expect((await app.inject({ url: '/trades/monitor' })).json()).toMatchObject({ lossCount: 2, lossLimit: 2, alert: true });
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

  it('reads the Open XML (.xlsx) report', async () => {
    const shared = ['Account:', '99887766 (USD, Broker, real)', 'XAUUSD', 'sell'];
    const cell = (ref: string, value: string | number) =>
      typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="s"><v>${shared.indexOf(value)}</v></c>`;
    const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">${cell('A1', 'Account:')}${cell('D1', '99887766 (USD, Broker, real)')}</row>
      <row r="2">${inline('A2', '2026.09.24 09:00:00')}<c r="B2"><v>777</v></c>${cell('C2', 'XAUUSD')}${cell('D2', 'sell')}${cell('E2', 0.2)}${cell('F2', 4400)}<c r="G2"/><c r="H2"/>${inline('I2', '2026.09.24 10:00:00')}${cell('J2', 4390)}${cell('K2', 0)}${cell('L2', 0)}${cell('M2', 200)}</row>
    </sheetData></worksheet>`;
    const sst = `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
    const xlsx = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet), 'xl/sharedStrings.xml': strToU8(sst) }));

    const preview = (await importFile({ timezone: 'UTC' }, xlsx, 'ReportHistory.xlsx')).json();
    expect(preview).toMatchObject({ account: '99887766', summary: { total: 1, ready: 1 } });
    expect(preview.positions[0]).toMatchObject({ direction: 'short', volume: 0.2, openedAt: '2026-09-24T09:00:00.000Z', resultUnits: 100 });
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

describe('account profile', () => {
  let trader: Record<string, string>;
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/me', payload, headers: trader });
  const stats = async () => (await app.inject({ url: '/trades/stats', headers: trader })).json();
  // XAUUSD: 1 lot, 1 pip (0.1) = 10 USD, so 0.1 lot moves 1 USD per 0.1.
  const trade = (day: string, exitPrice: number) =>
    post(
      '/trades',
      { instrumentId: ids.XAUUSD, direction: 'long', openedAt: `${day}T08:00:00Z`, closedAt: `${day}T09:00:00Z`, entryPrice: 4000, exitPrice, positionSize: 1 },
      trader,
    );

  beforeAll(async () => {
    const user = (await post('/educators', { displayName: 'Prop trader' })).json();
    trader = { 'x-user-id': user.id };
    await trade('2026-09-01', 4005); // +500
    await trade('2026-09-02', 3997); // −300
    await trade('2026-09-03', 3996); // −400
  });

  it('is optional: no account figures without a profile', async () => {
    const s = await stats();
    expect(s.account).toBeNull();
    expect(s.summary).toMatchObject({ pnl: -200, maxDrawdown: 700, returnPct: null, maxDrawdownPct: null });
  });

  it('requires the size, and the drawdown for prop accounts', async () => {
    expect((await patch({ accountType: 'live' })).json().error).toBe('Podaj wielkość konta');
    expect((await patch({ accountType: 'prop', accountSize: 10_000 })).statusCode).toBe(400);
  });

  it('measures a prop account against its static maximum drawdown', async () => {
    const me = (await patch({ accountType: 'prop', accountSize: 10_000, maxDrawdownPct: 10 })).json();
    expect(me.settings.account).toEqual({ type: 'prop', size: 10_000, maxDrawdownPct: 10, profitTargetPct: null, startDate: null });

    const s = await stats();
    expect(s.summary).toMatchObject({ returnPct: -2, maxDrawdown: 700, maxDrawdownPct: 7 });
    expect(s.account).toMatchObject({
      balance: 9800,
      pnl: -200,
      returnPct: -2,
      currentDrawdown: 700,
      maxDrawdown: 700,
      trades: 3,
      prop: { limit: 1000, floor: 9000, used: 200, remaining: 800, usedPct: 20, breached: false, target: null },
    });

    await patch({ profitTargetPct: 8 });
    expect((await stats()).account.prop.target).toEqual({ pct: 8, amount: 800, balance: 10_800, progressPct: 0, remaining: 1000, reached: false });
  });

  it('counts only trades since the account start and switches off again', async () => {
    const s = (await patch({ accountStartDate: '2026-09-02' }), await stats());
    expect(s.account).toMatchObject({ balance: 9300, trades: 2, prop: { used: 700, remaining: 300, usedPct: 70 } });
    // From the first day again, with a big win on top: +500 −300 −400 +1200.
    await patch({ accountStartDate: '2026-09-01', profitTargetPct: 4 });
    await trade('2026-09-04', 4012); // +1200 → balance 11000, pnl +1000
    expect((await stats()).account.prop.target).toMatchObject({ amount: 400, progressPct: 100, remaining: 0, reached: true });

    await patch({ accountType: 'live', accountStartDate: null });
    expect((await stats()).account).toMatchObject({ type: 'live', balance: 11_000, prop: null });

    await patch({ accountType: null });
    expect((await stats()).account).toBeNull();
  });
});
