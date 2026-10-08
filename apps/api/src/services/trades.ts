import {
  averageExitPrice,
  canSplit,
  closesPosition,
  isWholeSteps,
  sizeStep,
  computeTradeMetrics,
  tradeSession,
  type PartResult,
  type TradePartInput,
  emotionLabel,
  riskQuote,
  formatDayLabel,
  newsAffectsInstrument,
  toLocalDate,
  tradeOutcome,
  validatePriceSides,
  type AssetClass,
  type CreateTradeInput,
  type DisciplineCheck,
  type FxRateSource,
  type TradeFilters,
  type TradeOutcome,
} from '@trading/shared';
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import {
  dailySpreads,
  emotions,
  instrumentCurrencies,
  instruments,
  newsItems,
  signals,
  strategies,
  strategyRules,
  tradeEmotions,
  tradeExits,
  trades,
  tradeScreenshots,
  users,
} from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { t as tr } from '../i18n.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { accountBalanceCurve, accountLimits, accountOverview, accountTradeRows, balanceAt, getAccount, listAccounts } from './accounts.ts';
import { getFxRate, supportsAutoRate, type FxProvider } from './fx.ts';

export interface TradeContext {
  db: DB;
  fx: FxProvider;
}

type Instrument = typeof instruments.$inferSelect;

/** Merged create/update input, before derived fields are computed. */
/** Older trades may have no account; assertAccount rejects saving one without. */
type TradeDraft = Omit<CreateTradeInput, 'emotionKeys' | 'accountId'> & { accountId: string | null };

async function loadInstrument(db: DB, id: string): Promise<Instrument> {
  const [instrument] = await db.select().from(instruments).where(eq(instruments.id, id));
  if (!instrument) throw badRequest('unknownInstrument');
  return instrument;
}

/** Futures trade in whole contracts; CFD lots may be fractional. */
function assertPositionSize(instrument: Instrument, size: number) {
  if (instrument.market === 'futures' && !Number.isInteger(size)) {
    throw badRequest('futuresWholeContracts', { symbol: instrument.symbol });
  }
}

/**
 * Every trade needs an account (older trades without one must get one when edited); it must be the
 * user's, and a prop account's market must match the instrument.
 */
async function assertAccount(db: DB, user: CurrentUser, accountId: string | null | undefined, instrument: Instrument) {
  if (!accountId) throw badRequest('accountRequired');
  const account = await getAccount(db, user, accountId);
  if (account.market && account.market !== instrument.market) {
    throw badRequest('accountMarketMismatch', {
      account: account.name,
      market: account.market === 'cfd' ? 'CFD' : 'futures',
      symbol: instrument.symbol,
    });
  }
}

/** Fills educator/source from the linked signal and checks the educator exists. */
async function resolveSource(db: DB, draft: TradeDraft): Promise<Pick<TradeDraft, 'source' | 'educatorId' | 'signalId'>> {
  let { source, educatorId = null, signalId = null } = draft;
  if (signalId) {
    const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
    if (!signal) throw badRequest('unknownSignal');
    educatorId ??= signal.educatorId;
    source = 'educator';
  }
  if (source === 'own') return { source, educatorId: null, signalId: null };
  if (!educatorId) throw badRequest('chooseEducator');
  const [educator] = await db.select({ role: users.role }).from(users).where(eq(users.id, educatorId));
  if (!educator || (educator.role !== 'educator' && educator.role !== 'admin')) throw badRequest('unknownEducator');
  return { source, educatorId, signalId };
}

async function assertEmotionKeys(db: DB, keys: string[]) {
  if (keys.length === 0) return;
  const found = await db.select({ key: emotions.key }).from(emotions).where(inArray(emotions.key, keys));
  const missing = keys.filter((k) => !found.some((f) => f.key === k));
  if (missing.length > 0) throw badRequest('unknownEmotions', { keys: missing.join(', ') });
}

/**
 * A manual rate wins; otherwise the ECB rate from the day the trade closed (or opened, while open).
 */
async function resolveFx(ctx: TradeContext, user: CurrentUser, instrument: Instrument, draft: TradeDraft, manualRate: number | null) {
  if (manualRate != null) return { fxRate: manualRate, fxRateSource: 'manual' as FxRateSource, warning: null };

  const day = new Date(draft.closedAt ?? draft.openedAt).toISOString().slice(0, 10);
  const quote = await getFxRate(ctx.db, ctx.fx, instrument.quoteCurrency, user.accountCurrency, day);
  if (quote) return { fxRate: quote.rate, fxRateSource: 'auto' as FxRateSource, warning: null };

  const pair = `${instrument.quoteCurrency}/${user.accountCurrency}`;
  return {
    fxRate: null,
    fxRateSource: null,
    warning: tr(user.language, supportsAutoRate(instrument.quoteCurrency, user.accountCurrency) ? 'fxFailed' : 'fxManual', { pair }),
  };
}

/** An explicit spread (even null) wins; otherwise the spread saved for that instrument and day. */
async function resolveSpread(db: DB, user: CurrentUser, instrumentId: string, tradeDate: string, explicit: number | null | undefined) {
  if (explicit !== undefined) return explicit;
  const [row] = await db
    .select({ spreadUnits: dailySpreads.spreadUnits })
    .from(dailySpreads)
    .where(and(eq(dailySpreads.userId, user.id), eq(dailySpreads.instrumentId, instrumentId), eq(dailySpreads.date, tradeDate)));
  return row?.spreadUnits ?? null;
}

/** A part with its close price worked out (null while open). */
interface ResolvedPart {
  kind: PartResult;
  takeProfit: number | null;
  stopLoss: number | null;
  price: number | null;
  size: number;
  closedAt: Date | null;
}

/** Planned take profits: the list, or `takeProfit` alone (older clients and imports). */
const targetsOf = (d: Pick<TradeDraft, 'takeProfits' | 'takeProfit'>) =>
  d.takeProfits?.length ? d.takeProfits : d.takeProfit != null ? [d.takeProfit] : [];

/** What a single legacy exit price was: the take profit, the stop, breakeven or something else. */
function inferKind(d: { exitPrice: number; entryPrice: number; stopLoss?: number | null }, targets: readonly number[]): PartResult {
  if (targets.includes(d.exitPrice)) return 'tp';
  if (d.stopLoss != null && d.exitPrice === d.stopLoss) return 'sl';
  if (d.exitPrice === d.entryPrice) return 'be';
  return 'manual';
}

/**
 * The parts of a trade with close prices filled in. `parts` wins; without it a legacy `exitPrice`
 * (older clients, MT5 import) is one part closing everything. A part's stop defaults to the
 * previous part's (the first one to the trade's). Throws when a closed part cannot be priced, when
 * futures are split into fractions, or when the parts exceed the position.
 */
function resolveParts(instrument: Instrument, draft: TradeDraft, parts: TradePartInput[] | null): ResolvedPart[] {
  const targets = targetsOf(draft);
  const list: TradePartInput[] =
    parts ??
    (draft.exitPrice != null
      ? [
          {
            size: draft.positionSize,
            takeProfit: targets[0] ?? null,
            stopLoss: draft.stopLoss ?? null,
            result: inferKind({ ...draft, exitPrice: draft.exitPrice }, targets),
            price: draft.exitPrice,
            closedAt: draft.closedAt ?? null,
          },
        ]
      : []);
  const step = sizeStep(instrument.market);
  if (list.length > 1 && !canSplit(draft.positionSize, step)) {
    throw badRequest('partsTooSmall', { size: draft.positionSize, min: 2 * step });
  }
  let previousStop = draft.stopLoss ?? null;
  const resolved = list.map((p, i): ResolvedPart => {
    const stopLoss = p.stopLoss === undefined ? previousStop : p.stopLoss;
    previousStop = stopLoss ?? previousStop;
    const takeProfit = p.takeProfit ?? null;
    let price: number | null = null;
    if (p.result === 'tp') {
      price = takeProfit;
      if (price == null) throw badRequest('partNoTarget', { n: i + 1 });
    } else if (p.result === 'sl') {
      price = stopLoss;
      if (price == null) throw badRequest('partNoStop', { n: i + 1 });
    } else if (p.result === 'be') price = draft.entryPrice;
    else if (p.result === 'manual') {
      price = p.price ?? null;
      if (price == null) throw badRequest('partNoPrice', { n: i + 1 });
    }
    if (instrument.market === 'futures' && !Number.isInteger(p.size)) throw badRequest('futuresWholeContracts', { symbol: instrument.symbol });
    if (list.length > 1 && !isWholeSteps(p.size, step)) throw badRequest('partSizeStep', { n: i + 1, step });
    return { kind: p.result, takeProfit, stopLoss, price, size: p.size, closedAt: price != null && p.closedAt ? new Date(p.closedAt) : null };
  });
  const total = resolved.reduce((sum, p) => sum + p.size, 0);
  if (total > draft.positionSize + 1e-6) throw badRequest('partsTooLarge', { size: draft.positionSize });
  return resolved;
}

/**
 * Exit price and close time follow the parts: set (average price, last close) once every part is
 * closed and they cover the whole position, empty while anything is still open.
 */
function closeState(draft: TradeDraft, parts: ResolvedPart[]): Pick<TradeDraft, 'exitPrice' | 'closedAt'> {
  const closed = parts.filter((p): p is ResolvedPart & { price: number } => p.price != null);
  if (closed.length === 0 || closed.length < parts.length || !closesPosition(closed, draft.positionSize)) return { exitPrice: null, closedAt: null };
  const times = closed.map((p) => p.closedAt?.getTime()).filter((t): t is number => t != null);
  const closedAt = times.length ? new Date(Math.max(...times)).toISOString() : (draft.closedAt ?? new Date().toISOString());
  return { exitPrice: averageExitPrice(closed), closedAt };
}

/**
 * With parts, the trade's own levels come from them: the stop of the first part (the initial risk)
 * and the take profits of all parts (TP1 = the first part's).
 */
function partLevels(draft: TradeDraft, parts: ResolvedPart[]): Pick<TradeDraft, 'stopLoss' | 'takeProfits'> {
  if (parts.length === 0) return { stopLoss: draft.stopLoss, takeProfits: draft.takeProfits };
  return {
    stopLoss: parts[0]!.stopLoss ?? draft.stopLoss ?? null,
    takeProfits: parts.map((p) => p.takeProfit).filter((tp): tp is number => tp != null),
  };
}

/** The strategy must be the user's; ticked rules are kept only when they belong to it. */
async function resolveStrategy(db: DB, user: CurrentUser, strategyId: string | null | undefined, checked: string[] | undefined) {
  if (!strategyId) return { strategyId: null, checkedRuleIds: [] as string[] };
  const [strategy] = await db.select({ id: strategies.id }).from(strategies).where(and(eq(strategies.id, strategyId), eq(strategies.userId, user.id)));
  if (!strategy) throw notFound('strategyNotFound');
  const rules = await db.select({ id: strategyRules.id }).from(strategyRules).where(eq(strategyRules.strategyId, strategyId));
  const ids = new Set(rules.map((r) => r.id));
  return { strategyId, checkedRuleIds: [...new Set(checked ?? [])].filter((id) => ids.has(id)) };
}

/** Computes every stored derived column from the user-entered fields. */
async function deriveColumns(
  ctx: TradeContext,
  user: CurrentUser,
  instrument: Instrument,
  draft: TradeDraft,
  { manualRate, spread, parts }: { manualRate: number | null; spread: number | null | undefined; parts: ResolvedPart[] },
) {
  const tradeDate = toLocalDate(new Date(draft.openedAt), user.timezone);
  const { warning, ...fx } = await resolveFx(ctx, user, instrument, draft, manualRate);
  const spreadUnits = await resolveSpread(ctx.db, user, instrument.id, tradeDate, spread);
  const metrics = computeTradeMetrics(instrument, { ...draft, fxRate: fx.fxRate, spreadUnits, takeProfits: targetsOf(draft), parts: parts.length ? parts : null });
  return {
    columns: { ...metrics, ...fx, spreadUnits, tradeDate, accountCurrency: user.accountCurrency },
    warning,
  };
}

function toRow(draft: TradeDraft) {
  return {
    instrumentId: draft.instrumentId,
    direction: draft.direction,
    openedAt: new Date(draft.openedAt),
    closedAt: draft.closedAt ? new Date(draft.closedAt) : null,
    entryPrice: draft.entryPrice,
    exitPrice: draft.exitPrice ?? null,
    stopLoss: draft.stopLoss ?? null,
    takeProfit: targetsOf(draft)[0] ?? null,
    takeProfits: [...targetsOf(draft)],
    positionSize: draft.positionSize,
    fees: draft.fees ?? null,
    notes: draft.notes ?? null,
    accountId: draft.accountId ?? null,
  };
}

const collectWarnings = (user: CurrentUser, d: TradeDraft, fxWarning: string | null) => [
  ...validatePriceSides(d.direction, d.entryPrice, d.stopLoss, [...targetsOf(d)], user.language),
  ...(fxWarning ? [fxWarning] : []),
];

/** `externalId` marks a trade imported from a platform (see services/mt5-import.ts). */
export async function createTrade(ctx: TradeContext, user: CurrentUser, input: CreateTradeInput, { externalId }: { externalId?: string } = {}) {
  const { db } = ctx;
  const { emotionKeys, parts: partInput, checkedRuleIds, ...input2 } = input;
  const draft: TradeDraft = { ...input2 };
  const instrument = await loadInstrument(db, draft.instrumentId);
  assertPositionSize(instrument, draft.positionSize);
  await assertAccount(db, user, draft.accountId, instrument);
  const source = await resolveSource(db, draft);
  await assertEmotionKeys(db, emotionKeys);
  const strategy = await resolveStrategy(db, user, draft.strategyId, checkedRuleIds);
  const parts = resolveParts(instrument, draft, partInput ?? null);
  Object.assign(draft, closeState(draft, parts), partLevels(draft, parts));
  const { columns, warning } = await deriveColumns(ctx, user, instrument, draft, {
    manualRate: draft.fxRate ?? null,
    spread: draft.spread,
    parts,
  });

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({ ...toRow(draft), ...columns, ...source, ...strategy, userId: user.id, externalId: externalId ?? null })
      .returning({ id: trades.id });
    if (emotionKeys.length > 0) {
      await tx.insert(tradeEmotions).values(emotionKeys.map((emotionKey) => ({ tradeId: row!.id, emotionKey })));
    }
    if (parts.length > 0) await tx.insert(tradeExits).values(parts.map((p, i) => ({ ...p, tradeId: row!.id, sortOrder: i })));
    return row!.id;
  });
  return { trade: await getTrade(db, user, id), warnings: collectWarnings(user, draft, warning), fxWarning: warning };
}

export async function updateTrade(ctx: TradeContext, user: CurrentUser, id: string, patch: Partial<CreateTradeInput>) {
  const { db } = ctx;
  const [existing] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, user.id)));
  if (!existing) throw notFound('tradeNotFound');

  const { emotionKeys, parts: partPatch, checkedRuleIds, ...fields } = patch;
  const draft: TradeDraft = {
    instrumentId: existing.instrumentId,
    direction: existing.direction,
    openedAt: existing.openedAt.toISOString(),
    closedAt: existing.closedAt?.toISOString() ?? null,
    entryPrice: existing.entryPrice,
    exitPrice: existing.exitPrice,
    stopLoss: existing.stopLoss,
    takeProfit: existing.takeProfit,
    positionSize: existing.positionSize,
    fees: existing.fees,
    notes: existing.notes,
    source: existing.source,
    educatorId: existing.educatorId,
    signalId: existing.signalId,
    accountId: existing.accountId,
    takeProfits: existing.takeProfits,
    strategyId: existing.strategyId,
    ...fields,
  };
  // A new TP1 alone (older clients) replaces the list.
  if ('takeProfit' in fields && !('takeProfits' in fields)) draft.takeProfits = fields.takeProfit != null ? [fields.takeProfit] : [];
  if (fields.source === 'own') Object.assign(draft, { educatorId: null, signalId: null });

  const instrument = await loadInstrument(db, draft.instrumentId);
  assertPositionSize(instrument, draft.positionSize);
  await assertAccount(db, user, draft.accountId, instrument);
  const source = await resolveSource(db, draft);
  if (emotionKeys) await assertEmotionKeys(db, emotionKeys);
  const strategy = await resolveStrategy(db, user, draft.strategyId, 'strategyId' in fields || checkedRuleIds ? checkedRuleIds : existing.checkedRuleIds);
  // Parts: the new list, a new single exit price (older clients), or the stored parts re-priced
  // against the current entry (a breakeven part follows a corrected entry).
  const storedParts = await db.select().from(tradeExits).where(eq(tradeExits.tradeId, id)).orderBy(tradeExits.sortOrder);
  const partInput: TradePartInput[] | null =
    partPatch ??
    ('exitPrice' in fields || 'closedAt' in fields || storedParts.length === 0
      ? null
      : storedParts.map((p) => ({
          size: p.size,
          takeProfit: p.takeProfit,
          stopLoss: p.stopLoss,
          result: p.kind,
          ...(p.kind === 'manual' && p.price != null ? { price: p.price } : {}),
          closedAt: p.closedAt?.toISOString() ?? null,
        })));
  const parts = resolveParts(instrument, draft, partInput);
  Object.assign(draft, closeState(draft, parts), partLevels(draft, parts));
  // A manually entered rate is kept until replaced; sending fxRate: null switches back to automatic.
  const manualRate =
    'fxRate' in fields ? (fields.fxRate ?? null) : existing.fxRateSource === 'manual' ? existing.fxRate : null;
  const { columns, warning } = await deriveColumns(ctx, user, instrument, draft, {
    manualRate,
    spread: 'spread' in fields ? fields.spread : existing.spreadUnits,
    parts,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(trades)
      .set({ ...toRow(draft), ...columns, ...source, ...strategy })
      .where(eq(trades.id, id));
    await tx.delete(tradeExits).where(eq(tradeExits.tradeId, id));
    if (parts.length > 0) await tx.insert(tradeExits).values(parts.map((p, i) => ({ ...p, tradeId: id, sortOrder: i })));
    if (emotionKeys) {
      await tx.delete(tradeEmotions).where(eq(tradeEmotions.tradeId, id));
      if (emotionKeys.length > 0) {
        await tx.insert(tradeEmotions).values(emotionKeys.map((emotionKey) => ({ tradeId: id, emotionKey })));
      }
    }
  });
  return { trade: await getTrade(db, user, id), warnings: collectWarnings(user, draft, warning) };
}

/**
 * Selects the user's trades with their daily number. The number is counted over all
 * trades of the day (before filters), so "3/26.09.2025" always means the third trade that day.
 * `accountDayIndex` counts within the trade's account (trades without one form their own group),
 * which is what the daily limit applies to, as in the trading monitor.
 */
function selectNumbered(db: DB, userId: string) {
  const numbered = db.$with('numbered').as(
    db
      .select({
        id: trades.id,
        dayIndex: sql<number>`row_number() over (partition by ${trades.tradeDate} order by ${trades.openedAt}, ${trades.createdAt})`
          .mapWith(Number)
          .as('day_index'),
        dayCount: sql<number>`count(*) over (partition by ${trades.tradeDate})`.mapWith(Number).as('day_count'),
        accountDayIndex: sql<number>`row_number() over (partition by ${trades.tradeDate}, ${trades.accountId} order by ${trades.openedAt}, ${trades.createdAt})`
          .mapWith(Number)
          .as('account_day_index'),
      })
      .from(trades)
      .where(eq(trades.userId, userId)),
  );
  return db
    .with(numbered)
    .select({
      ...getTableColumns(trades),
      dayIndex: numbered.dayIndex,
      dayCount: numbered.dayCount,
      accountDayIndex: numbered.accountDayIndex,
      instrumentSymbol: instruments.symbol,
      measureUnit: instruments.measureUnit,
      market: instruments.market,
      unitSize: instruments.unitSize,
      unitValue: instruments.unitValue,
    })
    .from(trades)
    .innerJoin(numbered, eq(numbered.id, trades.id))
    .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
    .$dynamic();
}

type NumberedRow = Awaited<ReturnType<ReturnType<typeof selectNumbered>['execute']>>[number];

/**
 * Red headlines (news_items.important) within the time span of the given closed trades, and what
 * each trade's instrument reacts to (newsAffectsInstrument()).
 */
async function importantNewsDuring(db: DB, rows: NumberedRow[]) {
  const closed = rows.filter((r) => r.closedAt != null);
  if (closed.length === 0) return { news: [], instrumentsById: new Map<string, { currencies: string[]; assetClass: AssetClass }>() };
  const instrumentIds = [...new Set(closed.map((r) => r.instrumentId))];
  const [instrumentRows, currencyRows] = await Promise.all([
    db.select({ id: instruments.id, assetClass: instruments.assetClass }).from(instruments).where(inArray(instruments.id, instrumentIds)),
    db.select().from(instrumentCurrencies).where(inArray(instrumentCurrencies.instrumentId, instrumentIds)),
  ]);
  const instrumentsById = new Map(
    instrumentRows.map((i) => [
      i.id,
      { assetClass: i.assetClass, currencies: currencyRows.filter((c) => c.instrumentId === i.id).map((c) => c.currency) },
    ]),
  );
  const from = new Date(Math.min(...closed.map((r) => r.openedAt.getTime())));
  const to = new Date(Math.max(...closed.map((r) => r.closedAt!.getTime())));
  const news = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      publishedAt: newsItems.publishedAt,
      currencies: newsItems.currencies,
      assets: newsItems.assets,
      category: newsItems.category,
    })
    .from(newsItems)
    .where(and(eq(newsItems.important, true), eq(newsItems.noise, false), gte(newsItems.publishedAt, from), lte(newsItems.publishedAt, to)))
    .orderBy(newsItems.publishedAt);
  return { news, instrumentsById };
}

async function decorate(db: DB, user: CurrentUser, rows: NumberedRow[]) {
  const ids = rows.map((r) => r.id);
  const strategyIds = [...new Set(rows.map((r) => r.strategyId).filter((id): id is string => id != null))];
  const [emotionRows, screenshotRows, exitRows, strategyRows, ruleCounts] = ids.length
    ? await Promise.all([
        db.select().from(tradeEmotions).where(inArray(tradeEmotions.tradeId, ids)),
        db.select().from(tradeScreenshots).where(inArray(tradeScreenshots.tradeId, ids)),
        db.select().from(tradeExits).where(inArray(tradeExits.tradeId, ids)).orderBy(tradeExits.sortOrder),
        strategyIds.length ? db.select({ id: strategies.id, name: strategies.name }).from(strategies).where(inArray(strategies.id, strategyIds)) : [],
        strategyIds.length
          ? db.select({ strategyId: strategyRules.strategyId, n: sql<number>`count(*)`.mapWith(Number) }).from(strategyRules).where(inArray(strategyRules.strategyId, strategyIds)).groupBy(strategyRules.strategyId)
          : [],
      ])
    : [[], [], [], [], []];
  const accounts = await listAccounts(db, user);
  const accountRows = await accountTradeRows(db, user, accounts.map((a) => a.id));
  const redNews = await importantNewsDuring(db, rows);

  return rows.map(({ userId: _userId, instrumentSymbol, measureUnit, market, unitSize, unitValue, ...t }) => {
    const risk = riskQuote({ measureUnit, unitSize, unitValue }, t);
    const riskAccount = risk == null || t.fxRate == null ? null : round2(risk * t.fxRate);
    // Balance of the trade's account when it was opened.
    const account = accounts.find((a) => a.id === t.accountId);
    const balance = account ? balanceAt(account, accountRows.get(account.id) ?? [], t.openedAt.getTime()) : null;
    const takeProfits = t.takeProfits.length ? t.takeProfits : t.takeProfit != null ? [t.takeProfit] : [];
    const own = exitRows.filter((e) => e.tradeId === t.id);
    // Trades saved before parts: the whole position is one part (closed at its exit price, or open).
    const parts = own.length
      ? own.map(({ id, kind, takeProfit, stopLoss, price, size, closedAt }) => ({ id, result: kind, takeProfit, stopLoss, price, size, closedAt }))
      : [
          {
            id: null,
            result: t.exitPrice != null ? inferKind({ ...t, exitPrice: t.exitPrice }, takeProfits) : ('open' as PartResult),
            takeProfit: takeProfits[0] ?? null,
            stopLoss: t.stopLoss,
            price: t.exitPrice,
            size: t.positionSize,
            closedAt: t.closedAt,
          },
        ];
    const closedSize = Math.round(parts.filter((p) => p.price != null).reduce((sum, p) => sum + p.size, 0) * 10_000) / 10_000;
    const strategy = strategyRows.find((r) => r.id === t.strategyId) ?? null;
    return {
    ...t,
    takeProfits,
    /** The position in parts (one part when it was not split), in order. */
    parts,
    closedSize,
    /** Part of the position closed, the rest still open (stats count the trade once fully closed). */
    partial: t.exitPrice == null && closedSize > 0,
    /** Session at the opening time (Asia, London, overlap, New York, off). */
    session: tradeSession(t.openedAt),
    strategy,
    /** Rules ticked against the strategy's rules (null without a strategy). */
    ruleCheck: strategy ? { checked: t.checkedRuleIds.length, total: ruleCounts.find((r) => r.strategyId === strategy.id)?.n ?? 0 } : null,
    /** Money at risk to the stop loss, in the account currency. */
    riskAccount,
    /** The same as % of its account's balance when the trade was opened (null without an account). */
    riskPct: riskAccount != null && balance != null && balance > 0 ? round2((riskAccount / balance) * 100) : null,
    dayLabel: formatDayLabel(t.dayIndex, t.tradeDate, t.direction),
    /** Over the daily limit within the trade's account (its own limit, or the default). */
    overDailyLimit: (() => {
      const limit = accountLimits(user, account).maxTradesPerDay;
      return limit != null && t.accountDayIndex > limit;
    })(),
    status: t.exitPrice == null ? ('open' as const) : ('closed' as const),
    /** Win, loss or breakeven (±BREAKEVEN_R); null while open. */
    outcome: tradeOutcome(t),
    /** Result as % of its account's balance when the trade was opened (null without an account). */
    pnlPct: t.pnlAccount != null && balance != null && balance > 0 ? round2((t.pnlAccount / balance) * 100) : null,
    instrument: { id: t.instrumentId, symbol: instrumentSymbol, measureUnit, market },
    emotionKeys: emotionRows.filter((e) => e.tradeId === t.id).map((e) => e.emotionKey),
    /** Red headlines about the trade's instrument while it was open (closed trades only). */
    redNews: t.closedAt
      ? redNews.news
          .filter((n) => n.publishedAt >= t.openedAt && n.publishedAt <= t.closedAt!)
          .filter((n) => {
            const instrument = redNews.instrumentsById.get(t.instrumentId);
            return instrument != null && newsAffectsInstrument(n, instrument);
          })
          .map(({ id, title, publishedAt }) => ({ id, title, publishedAt }))
      : [],
    screenshots: screenshotRows
      .filter((s) => s.tradeId === t.id)
      .map((s) => ({ id: s.id, url: `/files/${s.storageKey}`, mimeType: s.mimeType, sizeBytes: s.sizeBytes })),
    };
  });
}

export type TradeView = Awaited<ReturnType<typeof decorate>>[number];

export async function getTrade(db: DB, user: CurrentUser, id: string): Promise<TradeView> {
  const rows = await selectNumbered(db, user.id).where(eq(trades.id, id));
  if (rows.length === 0) throw notFound('tradeNotFound');
  return (await decorate(db, user, rows))[0]!;
}

function filterConditions(f: Partial<TradeFilters>): SQL[] {
  const conditions: (SQL | undefined)[] = [
    f.account === 'none' ? isNull(trades.accountId) : f.account ? eq(trades.accountId, f.account) : undefined,
    f.instrumentId ? eq(trades.instrumentId, f.instrumentId) : undefined,
    f.direction ? eq(trades.direction, f.direction) : undefined,
    f.source ? eq(trades.source, f.source) : undefined,
    f.status === 'open' ? isNull(trades.exitPrice) : f.status === 'closed' ? isNotNull(trades.exitPrice) : undefined,
    f.dateFrom ? gte(trades.tradeDate, f.dateFrom) : undefined,
    f.dateTo ? lte(trades.tradeDate, f.dateTo) : undefined,
    f.priceMin != null ? gte(trades.entryPrice, f.priceMin) : undefined,
    f.priceMax != null ? lte(trades.entryPrice, f.priceMax) : undefined,
    f.sizeMin != null ? gte(trades.positionSize, f.sizeMin) : undefined,
    f.sizeMax != null ? lte(trades.positionSize, f.sizeMax) : undefined,
  ];
  return conditions.filter((c): c is SQL => c !== undefined);
}

export async function listTrades(db: DB, user: CurrentUser, filters: TradeFilters) {
  const where = and(...filterConditions(filters));
  const [rows, [total]] = await Promise.all([
    selectNumbered(db, user.id)
      .where(where)
      .orderBy(desc(trades.openedAt), desc(trades.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(trades)
      .where(and(eq(trades.userId, user.id), where)),
  ]);
  return { items: await decorate(db, user, rows), total: total!.count };
}

export async function deleteTrade(db: DB, user: CurrentUser, id: string) {
  const [deleted] = await db
    .delete(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, user.id)))
    .returning({ id: trades.id });
  if (!deleted) throw notFound('tradeNotFound');
}

// --- Trading monitor ---------------------------------------------------------

/**
 * Today's discipline check, per trading account (plus one group for trades without an account):
 * trades taken against the daily limit, and losses counted as `lossAlertMode` says, in a row
 * (from the most recent closed trade) or all of the day. `alert` fires at `lossStreakAlert`.
 */
export async function tradingMonitor(db: DB, user: CurrentUser) {
  const today = toLocalDate(new Date(), user.timezone);
  const [rows, accounts] = await Promise.all([
    selectNumbered(db, user.id).where(eq(trades.tradeDate, today)).orderBy(trades.openedAt),
    listAccounts(db, user),
  ]);
  const isLoss = (t: (typeof rows)[number]) => tradeOutcome(t) === 'loss';

  const group = (accountId: string | null, name: string | null) => {
    const limits = accountLimits(user, accounts.find((a) => a.id === accountId));
    const own = rows.filter((t) => t.accountId === accountId);
    const closed = own
      .filter((t) => t.exitPrice != null)
      .sort((a, b) => (a.closedAt ?? a.openedAt).getTime() - (b.closedAt ?? b.openedAt).getTime());
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && isLoss(closed[i]!); i--) streak++;
    // In a row: the losses since the last non-losing trade. Day: every losing trade today.
    const counted = user.lossAlertMode === 'day' ? closed.filter(isLoss) : closed.slice(closed.length - streak);
    return {
      /** null = trades without an account. */
      accountId,
      name,
      /** The limits in force for this account (its own, or the defaults from the settings). */
      maxTradesPerDay: limits.maxTradesPerDay,
      lossLimit: limits.lossStreakAlert,
      /** Whether the account overrides a default. */
      ownLimits: limits.maxTradesPerDay !== user.maxTradesPerDay || limits.lossStreakAlert !== user.lossStreakAlert,
      tradesToday: own.length,
      overLimit: limits.maxTradesPerDay != null && own.length > limits.maxTradesPerDay,
      lossCount: counted.length,
      alert: counted.length >= limits.lossStreakAlert,
      /** Identifies the counted losses, so a dismissed alert comes back after the next loss. */
      alertKey: `${user.lossAlertMode}:${accountId ?? 'none'}:${counted.map((t) => t.id).join(',')}`,
      lossLabels: counted.map((t) => formatDayLabel(t.dayIndex, t.tradeDate, t.direction)),
      /** Result of today's closed trades in the account currency. */
      pnlToday: round2(closed.reduce((sum, t) => sum + (t.pnlAccount ?? 0), 0)),
      /** Today's trades in opening order; `outcome` is null while a trade is open. */
      trades: own.map((t) => ({
        id: t.id,
        openedAt: t.openedAt,
        symbol: t.instrumentSymbol,
        outcome: t.exitPrice == null ? null : tradeOutcome(t),
        rMultiple: t.exitPrice == null ? null : t.rMultiple,
        pnl: t.exitPrice == null ? null : t.pnlAccount,
      })),
    };
  };

  // Trades without an account form their own group when there are some today, or no accounts at all.
  const groups = [
    ...accounts.map((a) => group(a.id, a.name)),
    ...(accounts.length === 0 || rows.some((t) => t.accountId == null) ? [group(null, null)] : []),
  ];

  return {
    date: today,
    /** The defaults from the settings; each group carries the limits in force for it. */
    maxTradesPerDay: user.maxTradesPerDay,
    lossMode: user.lossAlertMode,
    lossLimit: user.lossStreakAlert,
    groups,
    alert: groups.some((g) => g.alert),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Statistics --------------------------------------------------------------

interface Bucket {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  rSum: number;
  rCount: number;
}

const emptyBucket = (): Bucket => ({ trades: 0, wins: 0, losses: 0, pnl: 0, rSum: 0, rCount: 0 });

const summarize = (b: Bucket) => ({
  trades: b.trades,
  wins: b.wins,
  losses: b.losses,
  /** Wins among wins and losses: breakevens are neutral. */
  winRate: b.wins + b.losses ? round2((b.wins / (b.wins + b.losses)) * 100) : null,
  avgR: b.rCount ? round2(b.rSum / b.rCount) : null,
  pnl: round2(b.pnl),
});

interface DayDetail {
  trades: number;
  wins: number;
  losses: number;
  overLimit: boolean;
  missingStop: boolean;
  missingEmotions: boolean;
  /** Losses counted per account for the losses warning (in a row, or all of the day). */
  lossRun: Map<string, number>;
  lossAlert: boolean;
}

const emptyDay = (): DayDetail => ({
  trades: 0,
  wins: 0,
  losses: 0,
  overLimit: false,
  missingStop: false,
  missingEmotions: false,
  lossRun: new Map(),
  lossAlert: false,
});

/** Win/loss/breakeven runs over trades in order; `recent` are the last 30 outcomes, oldest first. */
function streakStats(outcomes: TradeOutcome[]) {
  const max: Record<TradeOutcome, number> = { win: 0, loss: 0, breakeven: 0 };
  let current = null as { outcome: TradeOutcome; count: number } | null;
  for (const outcome of outcomes) {
    current = current?.outcome === outcome ? { outcome, count: current.count + 1 } : { outcome, count: 1 };
    max[outcome] = Math.max(max[outcome], current.count);
  }
  return { recent: outcomes.slice(-30), maxWin: max.win, maxLoss: max.loss, maxBreakeven: max.breakeven, current };
}

/** Stats over closed trades. Money totals are in the user's current account currency. */
export async function tradeStats(db: DB, user: CurrentUser, filters: Pick<TradeFilters, 'account' | 'instrumentId' | 'dateFrom' | 'dateTo'>) {
  const rows = await selectNumbered(db, user.id)
    .where(and(isNotNull(trades.exitPrice), ...filterConditions(filters)))
    .orderBy(trades.openedAt);
  const emotionRows = rows.length
    ? await db.select().from(tradeEmotions).where(inArray(tradeEmotions.tradeId, rows.map((r) => r.id)))
    : [];
  const educatorRows = await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.role, 'educator'));
  const accounts = await listAccounts(db, user);
  // Each account's own daily limits for the discipline checks.
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const all = emptyBucket();
  const byDay = new Map<string, number>();
  const dayDetails = new Map<string, DayDetail>();
  const outcomes: TradeOutcome[] = [];
  const byInstrument = new Map<string, Bucket>();
  const bySource = new Map<string, Bucket>();
  const byEmotion = new Map<string, Bucket>();
  const byDayIndex = new Map<string, Bucket>();
  let grossWin = 0;
  let grossLoss = 0;
  // Money of winning and losing trades (breakevens left out), for the averages.
  let winSum = 0;
  let lossSum = 0;
  let plannedSum = 0;
  let plannedCount = 0;
  let missingFx = 0;
  let streak = 0;
  let maxLossStreak = 0;
  // Peak-to-trough fall of the cumulative result within the period, trade by trade.
  let running = 0;
  let runningPeak = 0;
  let periodDrawdown = 0;

  const addTo = (b: Bucket, win: boolean, loss: boolean, pnl: number, r: number | null) => {
    b.trades++;
    if (win) b.wins++;
    if (loss) b.losses++;
    b.pnl += pnl;
    if (r != null) {
      b.rSum += r;
      b.rCount++;
    }
  };
  const add = (map: Map<string, Bucket>, key: string, win: boolean, loss: boolean, pnl: number, r: number | null) => {
    if (!map.has(key)) map.set(key, emptyBucket());
    addTo(map.get(key)!, win, loss, pnl, r);
  };

  for (const t of rows) {
    // Closed trades always have a result; breakeven (±BREAKEVEN_R) is neither a win nor a loss.
    const outcome = tradeOutcome(t) ?? 'breakeven';
    const win = outcome === 'win';
    const loss = outcome === 'loss';
    const inCurrency = t.pnlAccount != null && t.accountCurrency === user.accountCurrency;
    if (!inCurrency) missingFx++;
    const pnl = inCurrency ? t.pnlAccount! : 0;

    addTo(all, win, loss, pnl, t.rMultiple);
    if (pnl > 0) grossWin += pnl;
    if (pnl < 0) grossLoss -= pnl;
    if (win) winSum += pnl;
    if (loss) lossSum += pnl;
    if (t.plannedRR != null) {
      plannedSum += t.plannedRR;
      plannedCount++;
    }
    streak = loss ? streak + 1 : 0;
    maxLossStreak = Math.max(maxLossStreak, streak);
    running += pnl;
    runningPeak = Math.max(runningPeak, running);
    periodDrawdown = Math.max(periodDrawdown, runningPeak - running);

    byDay.set(t.tradeDate, (byDay.get(t.tradeDate) ?? 0) + pnl);
    outcomes.push(outcome);
    if (!dayDetails.has(t.tradeDate)) dayDetails.set(t.tradeDate, emptyDay());
    const day = dayDetails.get(t.tradeDate)!;
    day.trades++;
    if (win) day.wins++;
    if (loss) day.losses++;
    const limits = accountLimits(user, accountsById.get(t.accountId ?? ''));
    if (limits.maxTradesPerDay != null && t.accountDayIndex > limits.maxTradesPerDay) day.overLimit = true;
    if (t.stopLoss == null) day.missingStop = true;
    if (!emotionRows.some((e) => e.tradeId === t.id)) day.missingEmotions = true;
    const key = t.accountId ?? 'none';
    const counted = loss ? (day.lossRun.get(key) ?? 0) + 1 : user.lossAlertMode === 'day' ? (day.lossRun.get(key) ?? 0) : 0;
    day.lossRun.set(key, counted);
    if (counted >= limits.lossStreakAlert) day.lossAlert = true;
    add(byInstrument, t.instrumentSymbol, win, loss, pnl, t.rMultiple);
    const educator = educatorRows.find((e) => e.id === t.educatorId)?.name;
    const sourceLabel =
      t.source === 'own'
        ? tr(user.language, 'statsOwnAnalysis')
        : tr(user.language, 'statsEducator', { name: educator ?? tr(user.language, 'statsUnknownEducator') });
    add(bySource, sourceLabel, win, loss, pnl, t.rMultiple);
    add(byDayIndex, t.dayIndex >= 4 ? '4+' : String(t.dayIndex), win, loss, pnl, t.rMultiple);
    for (const e of emotionRows.filter((e) => e.tradeId === t.id)) add(byEmotion, e.emotionKey, win, loss, pnl, t.rMultiple);
  }

  let cumulative = 0;
  const equityCurve = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => {
      const day = dayDetails.get(date)!;
      return {
        date,
        pnl: round2(pnl),
        cumulative: round2((cumulative += pnl)),
        trades: day.trades,
        wins: day.wins,
        losses: day.losses,
        /** The day's discipline checks (true = kept): see DISCIPLINE_CHECKS in @trading/shared. */
        discipline: {
          limit: !day.overLimit,
          stopLoss: !day.missingStop,
          emotions: !day.missingEmotions,
          losses: !day.lossAlert,
        } satisfies Record<DisciplineCheck, boolean>,
      };
    });

  const entries = (map: Map<string, Bucket>) => [...map.entries()].map(([key, b]) => ({ key, ...summarize(b) }));
  const accountRows = await accountTradeRows(db, user, accounts.map((a) => a.id));
  const overviews = accounts.map((a) => accountOverview(a, accountRows.get(a.id) ?? [], user.timezone));
  const selected = filters.account && filters.account !== 'none' ? accounts.find((a) => a.id === filters.account) : undefined;
  if (filters.account && filters.account !== 'none' && !selected) throw notFound('accountNotFound');
  const account = selected ? overviews.find((o) => o.id === selected.id)! : null;
  const balanceCurve =
    selected && !filters.instrumentId ? accountBalanceCurve(selected, accountRows.get(selected.id) ?? [], equityCurve.map((p) => p.date)) : null;

  return {
    currency: user.accountCurrency,
    /** The selected account (the `account` filter) with balance, return and drawdown; null otherwise. */
    account,
    /** Every account of the user with its current figures. */
    accounts: overviews,
    summary: {
      ...summarize(all),
      avgPlannedRR: plannedCount ? round2(plannedSum / plannedCount) : null,
      avgWin: all.wins ? round2(winSum / all.wins) : null,
      avgLoss: all.losses ? round2(lossSum / all.losses) : null,
      profitFactor: grossLoss ? round2(grossWin / grossLoss) : null,
      maxLossStreak,
      /** Closed trades within ±BREAKEVEN_R of zero (neither wins nor losses). */
      breakevens: all.trades - all.wins - all.losses,
      /** Largest fall from a peak of the cumulative result in the period (money, positive). */
      maxDrawdown: round2(periodDrawdown),
      /** The same against the account size, when there is an account profile. */
      maxDrawdownPct: account ? round2((periodDrawdown / account.size) * 100) : null,
      /** Period result as % of the account size. */
      returnPct: account ? round2((all.pnl / account.size) * 100) : null,
      /** Closed trades left out of money totals (no FX rate, or another account currency). */
      tradesWithoutPnl: missingFx,
    },
    /** Days with closed trades: result, cumulative result, counts and discipline checks. */
    equityCurve,
    streaks: streakStats(outcomes),
    /** The selected account's balance after each day of the curve, for charting against the account. */
    balanceCurve,
    byInstrument: entries(byInstrument),
    bySource: entries(bySource),
    byEmotion: entries(byEmotion).map((e) => ({ ...e, label: emotionLabel(user.language, e.key) })),
    /** Results of the 1st, 2nd, 3rd and later trades of a day, to spot overtrading. */
    byDayIndex: entries(byDayIndex).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
