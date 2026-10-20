import {
  aggregateCandles,
  analysisSource,
  priceToUnits,
  RESOLUTION_MS,
  toLocalDate,
  tradeOutcome,
  type AnalysisResolution,
  type BacktestExitReason,
  type Candle,
  type CreateBacktestSessionInput,
  type OpenBacktestTradeInput,
  type StoredResolution,
} from '@trading/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { backtestSessions, backtestTrades, instruments, strategies, strategyRules } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { getAccount } from './accounts.ts';
import { getFxRate, type FxProvider } from './fx.ts';
import type { MarketDataProvider } from './market-data.ts';

/**
 * A replay asks for stretches of at most this many periods: Capital.com refuses a range of 1000
 * periods or more (`error.invalid.max.daterange`) and gives at most 1000 candles.
 */
export const BACKTEST_CHUNK = 960;
/** Past candles never change: a fetched stretch is kept this long in memory. */
const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; candles: Candle[] }>();

const round2 = (n: number) => Math.round(n * 100) / 100;
const storedFor = (resolution: AnalysisResolution): StoredResolution => (resolution === 'M3' ? 'M1' : resolution);

type Session = typeof backtestSessions.$inferSelect;
type BacktestTrade = typeof backtestTrades.$inferSelect;
type Instrument = typeof instruments.$inferSelect;

/** Backtesting replays an instrument's own Capital.com candles: CFDs, forex, crypto CFDs (not futures). */
async function replayInstrument(db: DB, instrumentId: string) {
  const [instrument] = await db.select().from(instruments).where(eq(instruments.id, instrumentId));
  if (!instrument) throw notFound('unknownInstrument');
  const source = analysisSource(instrument.symbol);
  if (!source) throw badRequest('analysisUnavailable', { symbol: instrument.symbol });
  if (source.via) throw badRequest('backtestFutures', { symbol: instrument.symbol, cfd: source.via });
  return { instrument, epic: source.epic };
}

/**
 * Historical candles from `from` to `to` (at most BACKTEST_CHUNK of the stored resolution; M3 is
 * merged from M1), oldest first. A stretch without trading gives none.
 */
export async function backtestCandles(db: DB, market: MarketDataProvider | null, instrumentId: string, resolution: AnalysisResolution, from: Date, to: Date) {
  if (!market) throw badRequest('liveUnavailable');
  const stored = storedFor(resolution);
  if (to <= from || to.getTime() - from.getTime() > BACKTEST_CHUNK * RESOLUTION_MS[stored]) throw badRequest('backtestRange');
  const { epic } = await replayInstrument(db, instrumentId);
  const key = `${epic}:${stored}:${from.toISOString()}:${to.toISOString()}`;
  const hit = cache.get(key);
  let candles: Candle[];
  if (hit && hit.at > Date.now() - CACHE_MS) candles = hit.candles;
  else {
    candles = await market.fetchCandles(epic, stored, { from, to, max: 1000 });
    // The last stretch (up to now) is still forming: not kept.
    if (to.getTime() < Date.now() - RESOLUTION_MS[stored]) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), candles });
    }
  }
  const inRange = candles.filter((c) => c.time >= from.toISOString() && c.time < to.toISOString());
  return { resolution, candles: resolution === 'M3' ? aggregateCandles(inRange, RESOLUTION_MS.M3) : inRange };
}

async function assertBacktestAccount(db: DB, user: CurrentUser, accountId: string) {
  const account = await getAccount(db, user, accountId);
  if (account.type !== 'backtest') throw badRequest('backtestAccountRequired');
  return account;
}

async function ownedSession(db: DB, user: CurrentUser, id: string) {
  const [session] = await db.select().from(backtestSessions).where(and(eq(backtestSessions.id, id), eq(backtestSessions.userId, user.id)));
  if (!session) throw notFound('backtestSessionNotFound');
  return session;
}

async function strategyRuleIds(db: DB, strategyId: string | null) {
  if (!strategyId) return [];
  return (await db.select({ id: strategyRules.id }).from(strategyRules).where(eq(strategyRules.strategyId, strategyId))).map((r) => r.id);
}

/** A session's figures: results, R, money, profit factor, drawdown, the curve and, with a strategy, by rules followed. */
export function backtestSummary(trades: Pick<BacktestTrade, 'closedAt' | 'resultUnits' | 'rMultiple' | 'pnl' | 'checkedRuleIds'>[], ruleCount = 0) {
  const closed = trades.filter((t) => t.closedAt != null && t.resultUnits != null).sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime());
  const bucket = (list: typeof closed) => {
    const outcomes = list.map((t) => tradeOutcome(t));
    const wins = outcomes.filter((o) => o === 'win').length;
    const losses = outcomes.filter((o) => o === 'loss').length;
    const totalR = round2(list.reduce((s, t) => s + (t.rMultiple ?? 0), 0));
    return {
      trades: list.length,
      wins,
      losses,
      breakevens: list.length - wins - losses,
      winRate: wins + losses ? round2((wins / (wins + losses)) * 100) : null,
      totalR,
      avgR: list.some((t) => t.rMultiple != null) ? round2(totalR / list.filter((t) => t.rMultiple != null).length) : null,
      pnl: round2(list.reduce((s, t) => s + (t.pnl ?? 0), 0)),
    };
  };
  const grossWin = closed.reduce((s, t) => s + Math.max(0, t.pnl ?? 0), 0);
  const grossLoss = closed.reduce((s, t) => s + Math.max(0, -(t.pnl ?? 0)), 0);
  let equity = 0;
  let r = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = closed.map((t) => {
    equity = round2(equity + (t.pnl ?? 0));
    r = round2(r + (t.rMultiple ?? 0));
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { at: t.closedAt!.toISOString(), pnl: equity, r };
  });
  const followed = (t: (typeof closed)[number]) => ruleCount > 0 && t.checkedRuleIds.length >= ruleCount;
  return {
    ...bucket(closed),
    profitFactor: grossLoss ? round2(grossWin / grossLoss) : null,
    maxDrawdown: round2(maxDrawdown),
    curve,
    byRules: ruleCount > 0 ? { followed: bucket(closed.filter(followed)), broken: bucket(closed.filter((t) => !followed(t))) } : null,
  };
}

const tradeView = (t: BacktestTrade) => ({
  ...t,
  outcome: t.closedAt ? tradeOutcome(t) : null,
});

/** The user's sessions, newest first, each with its account, instrument and figures. */
export async function listBacktestSessions(db: DB, user: CurrentUser) {
  const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.userId, user.id)).orderBy(desc(backtestSessions.updatedAt));
  if (sessions.length === 0) return [];
  const [trades, instrumentRows, strategyRows] = await Promise.all([
    db.select().from(backtestTrades).where(inArray(backtestTrades.sessionId, sessions.map((s) => s.id))),
    db.select({ id: instruments.id, symbol: instruments.symbol }).from(instruments).where(inArray(instruments.id, [...new Set(sessions.map((s) => s.instrumentId))])),
    db.select({ id: strategies.id, name: strategies.name }).from(strategies).where(eq(strategies.userId, user.id)),
  ]);
  return sessions.map((s) => {
    const own = trades.filter((t) => t.sessionId === s.id);
    const { curve: _curve, byRules: _byRules, ...summary } = backtestSummary(own);
    return {
      ...s,
      symbol: instrumentRows.find((i) => i.id === s.instrumentId)?.symbol ?? '',
      strategyName: strategyRows.find((x) => x.id === s.strategyId)?.name ?? null,
      openTrades: own.filter((t) => !t.closedAt).length,
      summary,
    };
  });
}

/** One session with its instrument, the strategy's rules, every trade and the figures. */
export async function getBacktestSession(db: DB, user: CurrentUser, id: string) {
  const session = await ownedSession(db, user, id);
  const [[instrument], trades, rules, [strategy]] = await Promise.all([
    db.select().from(instruments).where(eq(instruments.id, session.instrumentId)),
    db.select().from(backtestTrades).where(eq(backtestTrades.sessionId, session.id)).orderBy(asc(backtestTrades.openedAt)),
    session.strategyId
      ? db.select({ id: strategyRules.id, label: strategyRules.label }).from(strategyRules).where(eq(strategyRules.strategyId, session.strategyId)).orderBy(asc(strategyRules.sortOrder))
      : [],
    session.strategyId ? db.select({ id: strategies.id, name: strategies.name }).from(strategies).where(eq(strategies.id, session.strategyId)) : [],
  ]);
  const i = instrument!;
  return {
    ...session,
    instrument: { id: i.id, symbol: i.symbol, name: i.name, market: i.market, unitSize: i.unitSize, unitValue: i.unitValue, measureUnit: i.measureUnit, quoteCurrency: i.quoteCurrency },
    strategy: strategy ? { ...strategy, rules } : null,
    trades: trades.map(tradeView),
    summary: backtestSummary(trades, rules.length),
  };
}

export async function createBacktestSession(db: DB, user: CurrentUser, input: CreateBacktestSessionInput) {
  await assertBacktestAccount(db, user, input.accountId);
  await replayInstrument(db, input.instrumentId);
  if (input.strategyId) {
    const [own] = await db.select({ id: strategies.id }).from(strategies).where(and(eq(strategies.id, input.strategyId), eq(strategies.userId, user.id)));
    if (!own) throw notFound('strategyNotFound');
  }
  const startAt = new Date(input.startAt);
  if (startAt.getTime() > Date.now()) throw badRequest('backtestFuture');
  const [row] = await db
    .insert(backtestSessions)
    .values({ userId: user.id, accountId: input.accountId, instrumentId: input.instrumentId, resolution: input.resolution, startAt, cursorAt: startAt, strategyId: input.strategyId ?? null })
    .returning();
  return getBacktestSession(db, user, row!.id);
}

export async function updateBacktestSession(db: DB, user: CurrentUser, id: string, patch: { cursorAt?: string; resolution?: AnalysisResolution; finished?: boolean }) {
  const session = await ownedSession(db, user, id);
  await db
    .update(backtestSessions)
    .set({
      ...(patch.cursorAt ? { cursorAt: new Date(patch.cursorAt) } : {}),
      ...(patch.resolution ? { resolution: patch.resolution } : {}),
      ...(patch.finished !== undefined ? { finishedAt: patch.finished ? new Date() : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(backtestSessions.id, session.id));
  return getBacktestSession(db, user, id);
}

export async function deleteBacktestSession(db: DB, user: CurrentUser, id: string) {
  const session = await ownedSession(db, user, id);
  await db.delete(backtestSessions).where(eq(backtestSessions.id, session.id));
}

/** The stop must be on the losing side of the entry and the target on the winning side. */
function assertSides(direction: 'long' | 'short', entry: number, stopLoss: number | null | undefined, takeProfit: number | null | undefined) {
  const sign = direction === 'long' ? 1 : -1;
  if (stopLoss != null && (stopLoss - entry) * sign >= 0) throw badRequest('backtestStopSide');
  if (takeProfit != null && (takeProfit - entry) * sign <= 0) throw badRequest('backtestTargetSide');
}

export async function openBacktestTrade(db: DB, user: CurrentUser, sessionId: string, input: OpenBacktestTradeInput) {
  const session = await ownedSession(db, user, sessionId);
  assertSides(input.direction, input.entryPrice, input.stopLoss, input.takeProfit);
  const allowed = new Set(await strategyRuleIds(db, session.strategyId));
  const [row] = await db
    .insert(backtestTrades)
    .values({
      sessionId: session.id,
      userId: user.id,
      direction: input.direction,
      size: input.size,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss ?? null,
      initialStopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      openedAt: new Date(input.openedAt),
      checkedRuleIds: (input.checkedRuleIds ?? []).filter((r) => allowed.has(r)),
    })
    .returning();
  await db.update(backtestSessions).set({ updatedAt: new Date() }).where(eq(backtestSessions.id, session.id));
  return tradeView(row!);
}

async function ownedTrade(db: DB, user: CurrentUser, id: string) {
  const [trade] = await db.select().from(backtestTrades).where(and(eq(backtestTrades.id, id), eq(backtestTrades.userId, user.id)));
  if (!trade) throw notFound('backtestTradeNotFound');
  return trade;
}

/** Result of closing at `price`: units, money in the account currency (rate of the replay day) and R. */
async function closeMetrics(db: DB, fx: FxProvider, user: CurrentUser, trade: BacktestTrade, instrument: Instrument, price: number, at: Date) {
  const resultUnits = priceToUnits(instrument, trade.direction, trade.entryPrice, price);
  const pnlQuote = resultUnits * instrument.unitValue * trade.size;
  const rate = await getFxRate(db, fx, instrument.quoteCurrency, user.accountCurrency, toLocalDate(at, user.timezone));
  const riskUnits = trade.initialStopLoss == null ? null : Math.abs(trade.entryPrice - trade.initialStopLoss) / instrument.unitSize;
  return {
    resultUnits,
    pnl: rate ? round2(pnlQuote * rate.rate) : null,
    rMultiple: riskUnits ? round2(resultUnits / riskUnits) : null,
  };
}

export async function updateBacktestTrade(
  db: DB,
  fx: FxProvider,
  user: CurrentUser,
  id: string,
  patch: { stopLoss?: number | null; takeProfit?: number | null; close?: { price: number; at: string; reason: BacktestExitReason } },
) {
  const trade = await ownedTrade(db, user, id);
  if (trade.closedAt) throw badRequest('backtestTradeClosed');
  const stopLoss = patch.stopLoss !== undefined ? patch.stopLoss : trade.stopLoss;
  const takeProfit = patch.takeProfit !== undefined ? patch.takeProfit : trade.takeProfit;
  // A stop moved to the entry (breakeven) or beyond it into profit is allowed; only targets are checked.
  assertSides(trade.direction, trade.entryPrice, null, takeProfit);
  let closing = {};
  if (patch.close) {
    const [session] = await db.select().from(backtestSessions).where(eq(backtestSessions.id, trade.sessionId));
    const [instrument] = await db.select().from(instruments).where(eq(instruments.id, session!.instrumentId));
    const at = new Date(patch.close.at);
    closing = { closedAt: at, exitPrice: patch.close.price, exitReason: patch.close.reason, ...(await closeMetrics(db, fx, user, trade, instrument!, patch.close.price, at)) };
  }
  const [row] = await db
    .update(backtestTrades)
    .set({ stopLoss, takeProfit, ...closing, updatedAt: new Date() })
    .where(eq(backtestTrades.id, trade.id))
    .returning();
  await db.update(backtestSessions).set({ updatedAt: new Date() }).where(eq(backtestSessions.id, trade.sessionId));
  return tradeView(row!);
}

export async function deleteBacktestTrade(db: DB, user: CurrentUser, id: string) {
  const trade = await ownedTrade(db, user, id);
  await db.delete(backtestTrades).where(eq(backtestTrades.id, trade.id));
}
