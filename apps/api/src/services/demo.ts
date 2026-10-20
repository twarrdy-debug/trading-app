import { atr, fillOnCandle, RESOLUTION_MS, roundToStep, toLocalDate, type Candle, type CreateTradeInput, type Direction } from '@trading/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { favoriteInstruments, instruments, strategies, tradingAccounts, trades, users } from '../db/schema.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { createAccount, setAccountLinks } from './accounts.ts';
import type { QuoteProvider } from './basis.ts';
import type { FxProvider } from './fx.ts';
import { loadCandles } from './market-analysis.ts';
import type { MarketDataProvider } from './market-data.ts';
import { createStrategy } from './strategies.ts';
import { createTrade } from './trades.ts';

/**
 * The public demo (owner's variant A, 2026-10-20): one shared read-only user with sample data,
 * entered without signing in through a signed cookie (never a Better Auth session, so nothing of
 * the real account machinery is reachable). The trades are invented, but their prices are not:
 * entries, stops, targets and exits sit on real historical candles (Capital.com for the CFDs,
 * Yahoo for NQ), and each result is what the market then did. Rebuilt daily for the last 90 days.
 */

export const DEMO_EMAIL = 'demo@demo.alphalogfx.local';
export const DEMO_COOKIE = 'alphalog_demo';
/** How long one visit's cookie lasts. */
export const DEMO_TTL_MS = 12 * 3_600_000;
const DAYS = 90;
const HOUR = RESOLUTION_MS.H1;

// --- The cookie ----------------------------------------------------------------

const sign = (secret: string, expires: number) => createHmac('sha256', secret).update(`demo:${expires}`).digest('base64url');

/** A cookie value good until `now + DEMO_TTL_MS`: the expiry and its signature. */
export function demoCookieValue(secret: string, now = Date.now()) {
  const expires = now + DEMO_TTL_MS;
  return `${expires}.${sign(secret, expires)}`;
}

export function validDemoCookie(secret: string, value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const [raw, signature = ''] = value.split('.');
  const expires = Number(raw);
  if (!Number.isFinite(expires) || expires < now) return false;
  const expected = Buffer.from(sign(secret, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The cookie from a raw Cookie header. */
export const demoCookieFrom = (header: string | undefined) =>
  header
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEMO_COOKIE}=`))
    ?.slice(DEMO_COOKIE.length + 1);

// --- The user ----------------------------------------------------------------

export async function demoUser(db: DB): Promise<CurrentUser | null> {
  const [user] = await db.select().from(users).where(and(eq(users.email, DEMO_EMAIL), eq(users.demo, true)));
  return user ?? null;
}

async function ensureDemoUser(db: DB): Promise<CurrentUser> {
  const existing = await demoUser(db);
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      displayName: 'Demo',
      demo: true,
      emailVerified: true,
      onboardedAt: new Date(),
      accountCurrency: 'USD',
      timezone: 'Europe/Warsaw',
      language: 'en',
      maxTradesPerDay: 3,
      lossStreakAlert: 3,
      emailWeekAhead: false,
      emailDaySummary: false,
      emailUpdates: false,
    })
    .returning();
  return created!;
}

// --- The sample data -----------------------------------------------------------

/** Small deterministic generator (mulberry32), seeded by the day, so a day's demo is stable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)]!;

const NOTES = [
  'Waited for the London open sweep, then the CHoCH on M5.',
  'Entry from the FVG after the Asian low was taken.',
  'Took it early, before the candle closed.',
  'Clean setup, followed the plan.',
  'Moved on after the news spike; should have waited.',
  'Target at the previous day high.',
];

interface Market {
  symbol: string;
  candles: Candle[];
  /** Price step the levels are rounded to. */
  step: number;
}

/** About 90 days of hourly candles: from Capital.com when it is configured, else what is stored. */
async function cfdCandles(db: DB, market: MarketDataProvider | null, symbol: string, epic: string, now: number): Promise<Candle[]> {
  if (market) {
    const out: Candle[] = [];
    // Capital.com takes stretches of under 1000 periods, ending a little before now (a `to` past its
    // own clock is refused with error.invalid.daterange).
    const end = Math.floor((now - 10 * 60_000) / HOUR) * HOUR;
    for (let to = end; to > end - DAYS * 86_400_000 - 900 * HOUR; to -= 900 * HOUR) {
      try {
        out.push(...(await market.fetchCandles(epic, 'H1', { from: new Date(to - 900 * HOUR), to: new Date(to), max: 1000 })));
      } catch {
        // One stretch missing leaves fewer days, not none.
      }
    }
    const unique = [...new Map(out.map((c) => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
    if (unique.length > 200) return unique;
  }
  const [row] = await db.select({ id: instruments.id }).from(instruments).where(eq(instruments.symbol, symbol));
  return row ? loadCandles(db, row.id, 'H1', DAYS * 24) : [];
}

/** One sample trade on real candles: entered at a candle's open, closed where the next candles reached SL or TP. */
function simulate(r: () => number, m: Market, index: number, riskMoney: number, unitSize: number, unitValue: number, sizeStep: number, maxSize: number, now: number) {
  const candles = m.candles;
  const entryCandle = candles[index]!;
  const range = atr(candles.slice(Math.max(0, index - 30), index)) ?? null;
  if (!range) return null;
  const entry = roundToStep(entryCandle.open, m.step);
  const risk = range * (0.6 + r() * 0.5);
  const rr = pick(r, [1.5, 2, 2, 2.5, 3]);
  // A demo trader with a modest edge: about a third of the entries take the side the market then paid (checked
  // on the real candles that follow), the rest are a coin toss. The prices stay the market's.
  const winner = (['long', 'short'] as const).find((d) => {
    const s = d === 'long' ? 1 : -1;
    const level = { direction: d, stopLoss: entry - s * risk, takeProfit: entry + s * risk * rr };
    for (let i = index; i < Math.min(candles.length, index + 36); i++) {
      const fill = fillOnCandle(level, candles[i]!);
      if (fill) return fill.reason === 'tp';
    }
    return false;
  });
  const direction: Direction = winner && r() < 0.35 ? winner : r() < 0.5 ? 'long' : 'short';
  const sign = direction === 'long' ? 1 : -1;
  const stopLoss = roundToStep(entry - sign * risk, m.step);
  const takeProfit = roundToStep(entry + sign * risk * rr, m.step);
  const riskUnits = Math.abs(entry - stopLoss) / unitSize;
  const size = Math.min(maxSize, Math.max(sizeStep, Math.round(riskMoney / (riskUnits * unitValue) / sizeStep) * sizeStep));

  const minute = 2 + Math.floor(r() * 12);
  const openedAt = Date.parse(entryCandle.time) + minute * 60_000;
  // Now and then a trade is closed by hand a few hours in.
  const manualAfter = r() < 0.12 ? 2 + Math.floor(r() * 4) : null;
  let exit: number | null = null;
  let closedAt: number | null = null;
  for (let i = index; i < Math.min(candles.length, index + 36); i++) {
    const c = candles[i]!;
    // The entry candle counts only from the open on: its range is still the market's.
    const fill = fillOnCandle({ direction, stopLoss, takeProfit }, c);
    if (fill) {
      exit = roundToStep(fill.price, m.step);
      closedAt = Math.max(openedAt + 60_000, Date.parse(c.time) + Math.floor(r() * 50 + 5) * 60_000);
      break;
    }
    if (manualAfter != null && i === index + manualAfter) {
      exit = roundToStep(c.close, m.step);
      closedAt = Date.parse(c.time) + 59 * 60_000;
      break;
    }
  }
  if (exit == null && index + 36 < candles.length) {
    const c = candles[index + 36]!;
    exit = roundToStep(c.close, m.step);
    closedAt = Date.parse(c.time) + 59 * 60_000;
  }
  if (closedAt != null && closedAt > now) return null;
  return { direction, entry, stopLoss, takeProfit, size: Number(size.toFixed(4)), openedAt, exit, closedAt, won: exit != null && (exit - entry) * sign > 0 };
}

/**
 * Builds (again) the demo user's accounts, strategy, favourites and about 90 days of trades on real
 * prices. Returns the number of trades saved (copies on the linked prop account not counted).
 */
export async function buildDemo(db: DB, deps: { fx: FxProvider; quotes: QuoteProvider; market: MarketDataProvider | null }, now = Date.now()) {
  const user = await ensureDemoUser(db);
  // Start over: trades (their parts, emotions and copies go with them), accounts, strategies, favourites.
  await db.delete(trades).where(eq(trades.userId, user.id));
  await db.delete(tradingAccounts).where(eq(tradingAccounts.userId, user.id));
  await db.delete(strategies).where(eq(strategies.userId, user.id));
  await db.delete(favoriteInstruments).where(eq(favoriteInstruments.userId, user.id));

  const list = await db.select().from(instruments).where(inArray(instruments.symbol, ['US100', 'XAUUSD', 'EURUSD', 'NQ1', 'MNQ1']));
  const bySymbol = new Map(list.map((i) => [i.symbol, i]));
  await db
    .insert(favoriteInstruments)
    .values(['US100', 'XAUUSD', 'EURUSD', 'NQ1'].flatMap((s) => (bySymbol.get(s) ? [{ userId: user.id, instrumentId: bySymbol.get(s)!.id }] : [])))
    .onConflictDoNothing();

  const live = await createAccount(db, user, { name: 'Live 25K', type: 'live', size: 25_000, leverage: 100 });
  const prop = await createAccount(db, user, { name: 'Prop 50K', type: 'prop', market: 'futures', size: 50_000, maxDrawdownAmount: 2_500, drawdownType: 'eod', profitTargetAmount: 3_000 });
  const prop2 = await createAccount(db, user, { name: 'Prop 50K #2', type: 'prop', market: 'futures', size: 50_000, maxDrawdownAmount: 2_500, drawdownType: 'eod', profitTargetAmount: 3_000 });
  // A trade copier between the two prop accounts: each futures trade is saved on both.
  await setAccountLinks(db, user, prop.id, [prop2.id]);
  const strategy = await createStrategy(db, user, {
    name: 'London sweep',
    description: 'Liquidity sweep at the London open, entry on the shift in structure.',
    rules: ['Sweep of the Asian high or low', 'CHoCH on M5', 'Entry from the FVG', 'Stop behind the sweep'],
  });
  const ruleIds = strategy.rules.map((r) => r.id);

  // Real candles: CFDs from Capital.com (or what is stored), NQ futures from Yahoo.
  const markets: Market[] = [];
  for (const [symbol, epic, step] of [['US100', 'US100', 0.1], ['XAUUSD', 'GOLD', 0.01], ['EURUSD', 'EURUSD', 0.00001]] as const) {
    const candles = await cfdCandles(db, deps.market, symbol, epic, now);
    if (candles.length > 200) markets.push({ symbol, candles, step });
  }
  let nq: Candle[] = [];
  try {
    nq = (await deps.quotes.fetchCandles?.('NQ=F', 'H1')) ?? [];
  } catch {
    nq = [];
  }
  if (nq.length > 200) markets.push({ symbol: 'MNQ1', candles: nq, step: 0.25 });
  if (markets.length === 0) return 0;

  const r = rng(Number(toLocalDate(new Date(now), user.timezone).replaceAll('-', '')));
  const indexByTime = new Map(markets.map((m) => [m.symbol, new Map(m.candles.map((c, i) => [c.time, i]))]));
  let saved = 0;
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(now - d * 86_400_000);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const count = pick(r, [0, 1, 1, 1, 2, 2, 2, 3]);
    const hours = [...new Set(Array.from({ length: count }, () => 6 + Math.floor(r() * 10)))].sort((a, b) => a - b);
    for (const hour of hours) {
      const futures = markets.find((m) => m.symbol === 'MNQ1');
      const cfds = markets.filter((m) => m.symbol !== 'MNQ1');
      const m = futures && (cfds.length === 0 || r() < 0.4) ? futures : pick(r, cfds.length ? cfds : markets);
      const instrument = bySymbol.get(m.symbol);
      if (!instrument) continue;
      const at = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour)).toISOString();
      const index = indexByTime.get(m.symbol)!.get(at);
      if (index == null) continue;
      const isFutures = m.symbol === 'MNQ1';
      const t = simulate(r, m, index, isFutures ? 150 + r() * 100 : 100 + r() * 100, instrument.unitSize, instrument.unitValue, isFutures ? 1 : 0.01, isFutures ? 10 : 50, now);
      if (!t) continue;
      const followed = r() < 0.7;
      const input: CreateTradeInput = {
        instrumentId: instrument.id,
        accountId: isFutures ? prop.id : live.id,
        direction: t.direction,
        openedAt: new Date(t.openedAt).toISOString(),
        entryPrice: t.entry,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        positionSize: t.size,
        exitPrice: t.exit,
        closedAt: t.closedAt != null ? new Date(t.closedAt).toISOString() : null,
        source: 'own',
        emotionKeys: t.won ? [pick(r, ['calm', 'confident', 'calm'])] : [pick(r, ['fear', 'fomo', 'impatience', 'doubt', 'frustration'])],
        notes: r() < 0.3 ? pick(r, NOTES) : null,
        strategyId: r() < 0.8 ? strategy.id : null,
        checkedRuleIds: followed ? ruleIds : ruleIds.slice(0, 2 + Math.floor(r() * 2)),
      };
      if (!input.strategyId) input.checkedRuleIds = [];
      try {
        await createTrade({ db, fx: deps.fx }, user, input);
        saved++;
      } catch {
        // A trade the API refuses (e.g. a size step) is left out.
      }
    }
  }
  return saved;
}

/** Builds the demo shortly after start and again each new day. Returns a stop function. */
export function startDemoScheduler(db: DB, deps: Parameters<typeof buildDemo>[1], log: (msg: string) => void) {
  let builtFor = '';
  const run = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (builtFor === today) return;
    try {
      const n = await buildDemo(db, deps);
      builtFor = today;
      log(`demo: ${n} sample trades`);
    } catch (err) {
      log(`demo: ${(err as Error).message}`);
    }
  };
  const first = setTimeout(() => void run(), 30_000);
  const timer = setInterval(() => void run(), 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
