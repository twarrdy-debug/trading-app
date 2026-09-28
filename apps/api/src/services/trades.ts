import {
  computeTradeMetrics,
  emotionLabel,
  formatDayLabel,
  toLocalDate,
  validatePriceSides,
  type CreateTradeInput,
  type FxRateSource,
  type TradeFilters,
} from '@trading/shared';
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import {
  dailySpreads,
  emotions,
  instruments,
  signals,
  tradeEmotions,
  trades,
  tradeScreenshots,
  users,
} from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { t as tr } from '../i18n.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { getFxRate, supportsAutoRate, type FxProvider } from './fx.ts';

export interface TradeContext {
  db: DB;
  fx: FxProvider;
}

type Instrument = typeof instruments.$inferSelect;

/** Merged create/update input, before derived fields are computed. */
type TradeDraft = Omit<CreateTradeInput, 'emotionKeys'>;

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

/** Computes every stored derived column from the user-entered fields. */
async function deriveColumns(
  ctx: TradeContext,
  user: CurrentUser,
  instrument: Instrument,
  draft: TradeDraft,
  { manualRate, spread }: { manualRate: number | null; spread: number | null | undefined },
) {
  const tradeDate = toLocalDate(new Date(draft.openedAt), user.timezone);
  const { warning, ...fx } = await resolveFx(ctx, user, instrument, draft, manualRate);
  const spreadUnits = await resolveSpread(ctx.db, user, instrument.id, tradeDate, spread);
  const metrics = computeTradeMetrics(instrument, { ...draft, fxRate: fx.fxRate, spreadUnits });
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
    takeProfit: draft.takeProfit ?? null,
    positionSize: draft.positionSize,
    fees: draft.fees ?? null,
    notes: draft.notes ?? null,
  };
}

const collectWarnings = (user: CurrentUser, d: TradeDraft, fxWarning: string | null) => [
  ...validatePriceSides(d.direction, d.entryPrice, d.stopLoss, d.takeProfit == null ? [] : [d.takeProfit], user.language),
  ...(fxWarning ? [fxWarning] : []),
];

/** `externalId` marks a trade imported from a platform (see services/mt5-import.ts). */
export async function createTrade(ctx: TradeContext, user: CurrentUser, input: CreateTradeInput, { externalId }: { externalId?: string } = {}) {
  const { db } = ctx;
  const { emotionKeys, ...draft } = input;
  const instrument = await loadInstrument(db, draft.instrumentId);
  assertPositionSize(instrument, draft.positionSize);
  const source = await resolveSource(db, draft);
  await assertEmotionKeys(db, emotionKeys);
  const { columns, warning } = await deriveColumns(ctx, user, instrument, draft, {
    manualRate: draft.fxRate ?? null,
    spread: draft.spread,
  });

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({ ...toRow(draft), ...columns, ...source, userId: user.id, externalId: externalId ?? null })
      .returning({ id: trades.id });
    if (emotionKeys.length > 0) {
      await tx.insert(tradeEmotions).values(emotionKeys.map((emotionKey) => ({ tradeId: row!.id, emotionKey })));
    }
    return row!.id;
  });
  return { trade: await getTrade(db, user, id), warnings: collectWarnings(user, draft, warning), fxWarning: warning };
}

export async function updateTrade(ctx: TradeContext, user: CurrentUser, id: string, patch: Partial<CreateTradeInput>) {
  const { db } = ctx;
  const [existing] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, user.id)));
  if (!existing) throw notFound('tradeNotFound');

  const { emotionKeys, ...fields } = patch;
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
    ...fields,
  };
  if (fields.source === 'own') Object.assign(draft, { educatorId: null, signalId: null });

  const instrument = await loadInstrument(db, draft.instrumentId);
  assertPositionSize(instrument, draft.positionSize);
  const source = await resolveSource(db, draft);
  if (emotionKeys) await assertEmotionKeys(db, emotionKeys);
  // A manually entered rate is kept until replaced; sending fxRate: null switches back to automatic.
  const manualRate =
    'fxRate' in fields ? (fields.fxRate ?? null) : existing.fxRateSource === 'manual' ? existing.fxRate : null;
  const { columns, warning } = await deriveColumns(ctx, user, instrument, draft, {
    manualRate,
    spread: 'spread' in fields ? fields.spread : existing.spreadUnits,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(trades)
      .set({ ...toRow(draft), ...columns, ...source })
      .where(eq(trades.id, id));
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
      instrumentSymbol: instruments.symbol,
      measureUnit: instruments.measureUnit,
      market: instruments.market,
    })
    .from(trades)
    .innerJoin(numbered, eq(numbered.id, trades.id))
    .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
    .$dynamic();
}

type NumberedRow = Awaited<ReturnType<ReturnType<typeof selectNumbered>['execute']>>[number];

async function decorate(db: DB, user: CurrentUser, rows: NumberedRow[]) {
  const ids = rows.map((r) => r.id);
  const [emotionRows, screenshotRows] = ids.length
    ? await Promise.all([
        db.select().from(tradeEmotions).where(inArray(tradeEmotions.tradeId, ids)),
        db.select().from(tradeScreenshots).where(inArray(tradeScreenshots.tradeId, ids)),
      ])
    : [[], []];

  return rows.map(({ userId: _userId, instrumentSymbol, measureUnit, market, ...t }) => ({
    ...t,
    dayLabel: formatDayLabel(t.dayIndex, t.tradeDate, t.direction),
    overDailyLimit: user.maxTradesPerDay != null && t.dayIndex > user.maxTradesPerDay,
    status: t.exitPrice == null ? ('open' as const) : ('closed' as const),
    instrument: { id: t.instrumentId, symbol: instrumentSymbol, measureUnit, market },
    emotionKeys: emotionRows.filter((e) => e.tradeId === t.id).map((e) => e.emotionKey),
    screenshots: screenshotRows
      .filter((s) => s.tradeId === t.id)
      .map((s) => ({ id: s.id, url: `/files/${s.storageKey}`, mimeType: s.mimeType, sizeBytes: s.sizeBytes })),
  }));
}

export type TradeView = Awaited<ReturnType<typeof decorate>>[number];

export async function getTrade(db: DB, user: CurrentUser, id: string): Promise<TradeView> {
  const rows = await selectNumbered(db, user.id).where(eq(trades.id, id));
  if (rows.length === 0) throw notFound('tradeNotFound');
  return (await decorate(db, user, rows))[0]!;
}

function filterConditions(f: Partial<TradeFilters>): SQL[] {
  const conditions: (SQL | undefined)[] = [
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
 * Today's discipline check: trades taken against the daily limit, and losing trades in a row
 * (counted from the most recent closed trade of the day). `alert` fires at the user's `lossStreakAlert`.
 */
export async function tradingMonitor(db: DB, user: CurrentUser) {
  const today = toLocalDate(new Date(), user.timezone);
  const rows = await selectNumbered(db, user.id).where(eq(trades.tradeDate, today)).orderBy(trades.openedAt);
  const closed = rows
    .filter((t) => t.exitPrice != null)
    .sort((a, b) => (a.closedAt ?? a.openedAt).getTime() - (b.closedAt ?? b.openedAt).getTime());

  const isLoss = (t: (typeof closed)[number]) => (t.resultUnits ?? 0) < 0;
  let streak = 0;
  for (let i = closed.length - 1; i >= 0 && isLoss(closed[i]!); i--) streak++;
  // In a row: the losses since the last non-losing trade. Day: every losing trade today.
  const counted = user.lossAlertMode === 'day' ? closed.filter(isLoss) : closed.slice(closed.length - streak);

  return {
    date: today,
    tradesToday: rows.length,
    maxTradesPerDay: user.maxTradesPerDay,
    overLimit: user.maxTradesPerDay != null && rows.length > user.maxTradesPerDay,
    lossMode: user.lossAlertMode,
    /** Losses counted for the warning (in a row or all of the day, per `lossMode`). */
    lossCount: counted.length,
    lossLimit: user.lossStreakAlert,
    alert: counted.length >= user.lossStreakAlert,
    /** Identifies the counted losses, so a dismissed alert comes back after the next loss. */
    alertKey: `${user.lossAlertMode}:${counted.map((t) => t.id).join(',')}`,
    lossLabels: counted.map((t) => formatDayLabel(t.dayIndex, t.tradeDate, t.direction)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Account ---------------------------------------------------------------

/**
 * The account as of now: starting size plus every closed trade since `accountStartDate`
 * (all filters ignored). Drawdown is measured from the highest balance reached. For prop
 * accounts the maximum drawdown is static: the balance may not fall below
 * size × (1 − maxDrawdownPct), as most CFD prop firms define it.
 */
export async function accountOverview(db: DB, user: CurrentUser) {
  if (!user.accountType || user.accountSize == null) return null;
  const size = user.accountSize;
  const rows = await db
    .select({ pnl: trades.pnlAccount })
    .from(trades)
    .where(
      and(
        eq(trades.userId, user.id),
        isNotNull(trades.exitPrice),
        isNotNull(trades.pnlAccount),
        eq(trades.accountCurrency, user.accountCurrency),
        user.accountStartDate ? gte(trades.tradeDate, user.accountStartDate) : undefined,
      ),
    )
    .orderBy(asc(sql`coalesce(${trades.closedAt}, ${trades.openedAt})`));

  let balance = size;
  let peak = size;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const { pnl } of rows) {
    balance += pnl!;
    peak = Math.max(peak, balance);
    if (peak - balance > maxDrawdown) {
      maxDrawdown = peak - balance;
      maxDrawdownPct = (maxDrawdown / peak) * 100;
    }
  }

  const prop =
    user.accountType === 'prop' && user.maxDrawdownPct != null
      ? (() => {
          const limit = (size * user.maxDrawdownPct) / 100;
          const used = Math.max(0, size - balance);
          const pnl = balance - size;
          const target =
            user.profitTargetPct != null
              ? (() => {
                  const amount = (size * user.profitTargetPct) / 100;
                  return {
                    pct: user.profitTargetPct,
                    amount: round2(amount),
                    /** Balance at which the target is reached. */
                    balance: round2(size + amount),
                    progressPct: round2(Math.min(100, Math.max(0, (pnl / amount) * 100))),
                    remaining: round2(Math.max(0, amount - pnl)),
                    reached: pnl >= amount,
                  };
                })()
              : null;
          return {
            target,
            maxDrawdownPct: user.maxDrawdownPct,
            limit: round2(limit),
            /** Lowest allowed balance. */
            floor: round2(size - limit),
            used: round2(used),
            remaining: round2(Math.max(0, balance - (size - limit))),
            usedPct: round2(Math.min(100, (used / limit) * 100)),
            breached: balance <= size - limit,
          };
        })()
      : null;

  return {
    type: user.accountType,
    size,
    startDate: user.accountStartDate,
    trades: rows.length,
    balance: round2(balance),
    pnl: round2(balance - size),
    returnPct: round2(((balance - size) / size) * 100),
    currentDrawdown: round2(peak - balance),
    currentDrawdownPct: round2(((peak - balance) / peak) * 100),
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPct: round2(maxDrawdownPct),
    prop,
  };
}

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
  winRate: b.trades ? round2((b.wins / b.trades) * 100) : null,
  avgR: b.rCount ? round2(b.rSum / b.rCount) : null,
  pnl: round2(b.pnl),
});

/** Stats over closed trades. Money totals are in the user's current account currency. */
export async function tradeStats(db: DB, user: CurrentUser, filters: Pick<TradeFilters, 'instrumentId' | 'dateFrom' | 'dateTo'>) {
  const rows = await selectNumbered(db, user.id)
    .where(and(isNotNull(trades.exitPrice), ...filterConditions(filters)))
    .orderBy(trades.openedAt);
  const emotionRows = rows.length
    ? await db.select().from(tradeEmotions).where(inArray(tradeEmotions.tradeId, rows.map((r) => r.id)))
    : [];
  const educatorRows = await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.role, 'educator'));

  const all = emptyBucket();
  const byDay = new Map<string, number>();
  const byInstrument = new Map<string, Bucket>();
  const bySource = new Map<string, Bucket>();
  const byEmotion = new Map<string, Bucket>();
  const byDayIndex = new Map<string, Bucket>();
  let grossWin = 0;
  let grossLoss = 0;
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
    const units = t.resultUnits ?? 0;
    const win = units > 0;
    const loss = units < 0;
    const inCurrency = t.pnlAccount != null && t.accountCurrency === user.accountCurrency;
    if (!inCurrency) missingFx++;
    const pnl = inCurrency ? t.pnlAccount! : 0;

    addTo(all, win, loss, pnl, t.rMultiple);
    if (pnl > 0) grossWin += pnl;
    if (pnl < 0) grossLoss -= pnl;
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
    .map(([date, pnl]) => ({ date, pnl: round2(pnl), cumulative: round2((cumulative += pnl)) }));

  const entries = (map: Map<string, Bucket>) => [...map.entries()].map(([key, b]) => ({ key, ...summarize(b) }));
  const account = await accountOverview(db, user);

  return {
    currency: user.accountCurrency,
    /** Balance, return and drawdown against the account; null without an account profile. */
    account,
    summary: {
      ...summarize(all),
      avgPlannedRR: plannedCount ? round2(plannedSum / plannedCount) : null,
      avgWin: all.wins ? round2(grossWin / all.wins) : null,
      avgLoss: all.losses ? round2(-grossLoss / all.losses) : null,
      profitFactor: grossLoss ? round2(grossWin / grossLoss) : null,
      maxLossStreak,
      /** Largest fall from a peak of the cumulative result in the period (money, positive). */
      maxDrawdown: round2(periodDrawdown),
      /** The same against the account size, when there is an account profile. */
      maxDrawdownPct: account ? round2((periodDrawdown / account.size) * 100) : null,
      /** Period result as % of the account size. */
      returnPct: account ? round2((all.pnl / account.size) * 100) : null,
      /** Closed trades left out of money totals (no FX rate, or another account currency). */
      tradesWithoutPnl: missingFx,
    },
    equityCurve,
    byInstrument: entries(byInstrument),
    bySource: entries(bySource),
    byEmotion: entries(byEmotion).map((e) => ({ ...e, label: emotionLabel(user.language, e.key) })),
    /** Results of the 1st, 2nd, 3rd and later trades of a day, to spot overtrading. */
    byDayIndex: entries(byDayIndex).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
