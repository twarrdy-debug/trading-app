import { hasFeature, toLocalDate, zonedTimeToUtc, type AccountAdjustmentInput, type CreateAccountInput, type UpdateAccountInput } from '@trading/shared';
import { marketName } from '../i18n.ts';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { accountAdjustments, backtestSessions, backtestTrades, instruments, tradeScreenshots, tradingAccounts, trades } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

export type TradingAccount = typeof tradingAccounts.$inferSelect;

/** A closed trade's result as it counts for an account balance. */
export interface AccountTradeRow {
  pnl: number;
  /** Close time in ms (open time for trades closed without a time). */
  at: number;
  tradeDate: string;
  /** Set on a balance correction: the day it closes. */
  adjustmentDate?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const listAccounts = (db: DB, user: CurrentUser) =>
  db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, user.id)).orderBy(asc(tradingAccounts.createdAt));

/** The accounts of the journal, stats and monitor: every one but the backtesting ones. */
export const journalAccounts = (db: DB, user: CurrentUser) =>
  db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, user.id), ne(tradingAccounts.type, 'backtest')))
    .orderBy(asc(tradingAccounts.createdAt));

/** The daily limits in force for an account: its own where set, otherwise the user's defaults. */
export const accountLimits = (
  user: Pick<CurrentUser, 'maxTradesPerDay' | 'lossStreakAlert'>,
  account: Pick<TradingAccount, 'maxTradesPerDay' | 'lossStreakAlert'> | null | undefined,
) => ({
  maxTradesPerDay: account?.maxTradesPerDay ?? user.maxTradesPerDay,
  lossStreakAlert: account?.lossStreakAlert ?? user.lossStreakAlert,
});

export async function getAccount(db: DB, user: CurrentUser, id: string): Promise<TradingAccount> {
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, user.id)));
  if (!account) throw notFound('accountNotFound');
  return account;
}

/** Prop accounts need a market and a maximum drawdown (as % or an amount); checked on the account as it will be saved. */
function assertPropRules(account: Partial<CreateAccountInput>) {
  if (account.type !== 'prop') return;
  if (!account.market) throw badRequest('validation.propMarket');
  if (account.maxDrawdownPct == null && account.maxDrawdownAmount == null) throw badRequest('validation.propDrawdown');
  if (account.maxDrawdownAmount != null && account.size != null && account.maxDrawdownAmount >= account.size) throw badRequest('validation.drawdownOverSize');
}

/** A limit is stored either as % or as an amount: setting one clears the other. */
function oneUnit<T extends Partial<CreateAccountInput>>(input: T): T {
  const out = { ...input };
  if (out.maxDrawdownAmount != null) out.maxDrawdownPct = null;
  else if (out.maxDrawdownPct != null) out.maxDrawdownAmount = null;
  if (out.profitTargetAmount != null) out.profitTargetPct = null;
  else if (out.profitTargetPct != null) out.profitTargetAmount = null;
  return out;
}

/** A backtesting account has only a name, a size and a leverage: no market, prop limits or own limits. */
const backtestOnly = <T extends Partial<CreateAccountInput>>(input: T): T =>
  input.type === 'backtest'
    ? { ...input, market: null, maxDrawdownPct: null, maxDrawdownAmount: null, profitTargetPct: null, profitTargetAmount: null, maxTradesPerDay: null, lossStreakAlert: null }
    : input;

export async function createAccount(db: DB, user: CurrentUser, input: CreateAccountInput) {
  // Plans: backtesting accounts are part of Backtesting, more than one account is Pro and VIP.
  if (input.type === 'backtest' && !hasFeature(user.role, 'backtest')) throw new HttpError(403, 'planPro');
  if (!hasFeature(user.role, 'multipleAccounts')) {
    const [row] = await db.select({ n: count() }).from(tradingAccounts).where(eq(tradingAccounts.userId, user.id));
    if ((row?.n ?? 0) >= 1) throw new HttpError(403, 'accountLimit');
  }
  assertPropRules(input);
  const values = backtestOnly(oneUnit(input));
  const [row] = await db
    .insert(tradingAccounts)
    .values({ ...values, market: values.market ?? null, userId: user.id })
    .returning();
  return row!;
}

export async function updateAccount(db: DB, user: CurrentUser, id: string, patch: UpdateAccountInput) {
  const existing = await getAccount(db, user, id);
  if (patch.type && (patch.type === 'backtest') !== (existing.type === 'backtest')) throw badRequest('backtestTypeFixed');
  assertPropRules({ ...existing, ...patch });
  // Linked accounts share one market; changing it would break the link.
  if (existing.linkGroup && patch.market !== undefined && (patch.market ?? null) !== (existing.market ?? null)) {
    throw badRequest('linkMarketMismatch', { account: existing.name });
  }
  const [row] = await db
    .update(tradingAccounts)
    .set(backtestOnly({ ...oneUnit(patch), type: existing.type }))
    .where(eq(tradingAccounts.id, existing.id))
    .returning();
  return row!;
}

/**
 * Deletes the account. Its trades stay in the journal without an account (`keep`), move to another
 * of the user's accounts (`move`, which must accept their market), or are deleted with it (`delete`).
 * Returns the storage keys of deleted screenshots, for the caller to remove the files.
 */
export async function deleteAccount(
  db: DB,
  user: CurrentUser,
  id: string,
  { trades: mode = 'keep', moveTo }: { trades?: 'keep' | 'move' | 'delete'; moveTo?: string } = {},
): Promise<string[]> {
  const existing = await getAccount(db, user, id);
  const own = and(eq(trades.accountId, existing.id), eq(trades.userId, user.id));
  if (mode === 'move') {
    if (!moveTo || moveTo === existing.id) throw badRequest('moveTargetRequired');
    const target = await getAccount(db, user, moveTo);
    if (target.market) {
      const [other] = await db
        .select({ symbol: instruments.symbol })
        .from(trades)
        .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
        .where(and(own, ne(instruments.market, target.market)))
        .limit(1);
      if (other) throw badRequest('accountMarketMismatch', { account: target.name, market: marketName(user.language, target.market), symbol: other.symbol });
    }
  }
  return db.transaction(async (tx) => {
    let files: string[] = [];
    if (mode === 'move') await tx.update(trades).set({ accountId: moveTo }).where(own);
    if (mode === 'delete') {
      // Copies on the other linked accounts stay: one of them takes over.
      await promoteCopies(tx, (await tx.select({ id: trades.id }).from(trades).where(own)).map((r) => r.id));
      files = (
        await tx
          .select({ key: tradeScreenshots.storageKey })
          .from(tradeScreenshots)
          .innerJoin(trades, eq(trades.id, tradeScreenshots.tradeId))
          .where(own)
      ).map((r) => r.key);
      await tx.delete(trades).where(own);
    }
    await tx.delete(tradingAccounts).where(eq(tradingAccounts.id, existing.id));
    await dissolveLoneGroups(tx, user.id);
    return files;
  });
}

/**
 * Links the account with `others` (a trade copier: every trade saved on one is saved on all), or
 * unlinks it when `others` is empty. Linked accounts must trade the same market. Accounts that were
 * in the group but are left out are unlinked; a group of one is no group.
 */
export async function setAccountLinks(db: DB, user: CurrentUser, id: string, others: string[]) {
  const account = await getAccount(db, user, id);
  const ids = [...new Set([account.id, ...others])];
  const members = await db.select().from(tradingAccounts).where(and(eq(tradingAccounts.userId, user.id), inArray(tradingAccounts.id, ids)));
  if (members.length !== ids.length) throw notFound('accountNotFound');
  if (ids.length > 1 && members.some((m) => m.type === 'backtest')) throw badRequest('linkBacktest');
  const mismatch = members.find((m) => (m.market ?? null) !== (account.market ?? null));
  if (mismatch) throw badRequest('linkMarketMismatch', { account: mismatch.name });
  await db.transaction(async (tx) => {
    const group = members.find((m) => m.linkGroup)?.linkGroup ?? randomUUID();
    const old = [...new Set(members.map((m) => m.linkGroup).filter((g): g is string => g != null))];
    // Everyone else in the groups touched leaves them.
    if (old.length) {
      await tx
        .update(tradingAccounts)
        .set({ linkGroup: null })
        .where(and(eq(tradingAccounts.userId, user.id), inArray(tradingAccounts.linkGroup, old), notInArray(tradingAccounts.id, ids)));
    }
    await tx
      .update(tradingAccounts)
      .set({ linkGroup: ids.length > 1 ? group : null })
      .where(and(eq(tradingAccounts.userId, user.id), inArray(tradingAccounts.id, ids)));
  });
}

/** The other accounts linked with this one (empty when it is not linked). */
export async function linkedAccounts(db: DB, user: CurrentUser, account: Pick<TradingAccount, 'id' | 'linkGroup'>) {
  if (!account.linkGroup) return [];
  return db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, user.id), eq(tradingAccounts.linkGroup, account.linkGroup), ne(tradingAccounts.id, account.id)))
    .orderBy(asc(tradingAccounts.createdAt));
}

/** A group with one account left is no group. */
async function dissolveLoneGroups(db: Pick<DB, 'select' | 'update'>, userId: string) {
  const rows = await db
    .select({ group: tradingAccounts.linkGroup, n: count() })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), isNotNull(tradingAccounts.linkGroup)))
    .groupBy(tradingAccounts.linkGroup);
  const lone = rows.filter((r) => r.n < 2).map((r) => r.group!);
  if (lone.length) await db.update(tradingAccounts).set({ linkGroup: null }).where(inArray(tradingAccounts.linkGroup, lone));
}

/**
 * Before trades are deleted or moved out of a link: each of them that other trades copy hands that
 * role to its first copy, so the copies on other accounts survive.
 */
export async function promoteCopies(db: Pick<DB, 'select' | 'update'>, tradeIds: string[]) {
  if (tradeIds.length === 0) return;
  const copies = await db
    .select({ id: trades.id, copyOf: trades.copyOf })
    .from(trades)
    .where(and(inArray(trades.copyOf, tradeIds), notInArray(trades.id, tradeIds)))
    .orderBy(asc(trades.createdAt));
  const heirs = new Map<string, string>();
  for (const c of copies) if (!heirs.has(c.copyOf!)) heirs.set(c.copyOf!, c.id);
  for (const [source, heir] of heirs) {
    await db.update(trades).set({ copyOf: null }).where(eq(trades.id, heir));
    await db.update(trades).set({ copyOf: heir }).where(and(eq(trades.copyOf, source), ne(trades.id, heir)));
  }
}

/** How many trades (open ones included) each of the user's accounts has. */
export async function accountTradeCounts(db: DB, user: CurrentUser) {
  const rows = await db
    .select({ accountId: trades.accountId, n: count() })
    .from(trades)
    .where(and(eq(trades.userId, user.id), isNotNull(trades.accountId)))
    .groupBy(trades.accountId);
  return new Map(rows.map((r) => [r.accountId!, r.n]));
}

/** Closed trades of the given accounts in the user's current currency, oldest first, per account. */
export async function accountTradeRows(db: DB, user: CurrentUser, accountIds: string[]): Promise<Map<string, AccountTradeRow[]>> {
  const byAccount = new Map<string, AccountTradeRow[]>(accountIds.map((id) => [id, []]));
  if (accountIds.length === 0) return byAccount;
  const rows = await db
    .select({ accountId: trades.accountId, pnl: trades.pnlAccount, closedAt: trades.closedAt, openedAt: trades.openedAt, tradeDate: trades.tradeDate })
    .from(trades)
    .where(
      and(
        eq(trades.userId, user.id),
        inArray(trades.accountId, accountIds),
        isNotNull(trades.exitPrice),
        isNotNull(trades.pnlAccount),
        eq(trades.accountCurrency, user.accountCurrency),
      ),
    );
  for (const r of rows) byAccount.get(r.accountId!)?.push({ pnl: r.pnl!, at: (r.closedAt ?? r.openedAt).getTime(), tradeDate: r.tradeDate });
  // A backtesting account's balance moves with its sessions' closed positions (at their replay times).
  const backtest = await db
    .select({ accountId: backtestSessions.accountId, pnl: backtestTrades.pnl, closedAt: backtestTrades.closedAt })
    .from(backtestTrades)
    .innerJoin(backtestSessions, eq(backtestSessions.id, backtestTrades.sessionId))
    .where(and(eq(backtestTrades.userId, user.id), inArray(backtestSessions.accountId, accountIds), isNotNull(backtestTrades.pnl), isNotNull(backtestTrades.closedAt)));
  for (const r of backtest) byAccount.get(r.accountId)?.push({ pnl: r.pnl!, at: r.closedAt!.getTime(), tradeDate: toLocalDate(r.closedAt!, user.timezone) });
  // Balance corrections land at the very end of their day, after its trades.
  const adjustments = await db
    .select()
    .from(accountAdjustments)
    .where(and(eq(accountAdjustments.userId, user.id), inArray(accountAdjustments.accountId, accountIds)));
  for (const a of adjustments) byAccount.get(a.accountId)?.push({ pnl: a.amount, at: endOfDay(a.date, user.timezone) - 1, tradeDate: a.date, adjustmentDate: a.date });
  for (const list of byAccount.values()) list.sort((a, b) => a.at - b.at);
  return byAccount;
}

/** The instant a local day ends (the next day's midnight in `timeZone`), in ms. */
export function endOfDay(date: string, timeZone: string) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return zonedTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00:00`, timeZone).getTime();
}

/** The app's balance at the end of `date`, leaving out that day's own correction. */
async function balanceAtEndOf(db: DB, user: CurrentUser, account: TradingAccount, date: string) {
  const rows = (await accountTradeRows(db, user, [account.id])).get(account.id) ?? [];
  const end = endOfDay(date, user.timezone);
  return round2(rows.reduce((sum, r) => (r.at < end && r.adjustmentDate !== date ? sum + r.pnl : sum), account.size));
}

async function correctableAccount(db: DB, user: CurrentUser, id: string) {
  const account = await getAccount(db, user, id);
  if (account.type === 'backtest') throw badRequest('backtestAccountTrade');
  return account;
}

/** The app's balance at the end of a day and that day's correction, if any (for the form's preview). */
export async function accountDayBalance(db: DB, user: CurrentUser, id: string, date: string) {
  const account = await correctableAccount(db, user, id);
  const [existing] = await db.select().from(accountAdjustments).where(and(eq(accountAdjustments.accountId, account.id), eq(accountAdjustments.date, date)));
  return { date, computed: await balanceAtEndOf(db, user, account, date), adjustment: existing ?? null };
}

export async function listAdjustments(db: DB, user: CurrentUser, id: string) {
  const account = await correctableAccount(db, user, id);
  return db.select().from(accountAdjustments).where(eq(accountAdjustments.accountId, account.id)).orderBy(desc(accountAdjustments.date));
}

/** Saves the broker's end-of-day balance: the difference against the app's becomes that day's correction. */
export async function setAdjustment(db: DB, user: CurrentUser, id: string, date: string, input: AccountAdjustmentInput) {
  const account = await correctableAccount(db, user, id);
  if (date > toLocalDate(new Date(), user.timezone)) throw badRequest('adjustmentFuture');
  const computed = await balanceAtEndOf(db, user, account, date);
  const values = { userId: user.id, accountId: account.id, date, balance: input.balance, amount: round2(input.balance - computed), note: input.note ?? null };
  const [row] = await db
    .insert(accountAdjustments)
    .values(values)
    .onConflictDoUpdate({ target: [accountAdjustments.accountId, accountAdjustments.date], set: { balance: values.balance, amount: values.amount, note: values.note, updatedAt: new Date() } })
    .returning();
  return row!;
}

export async function deleteAdjustment(db: DB, user: CurrentUser, id: string, date: string) {
  const account = await correctableAccount(db, user, id);
  const [row] = await db
    .delete(accountAdjustments)
    .where(and(eq(accountAdjustments.accountId, account.id), eq(accountAdjustments.date, date)))
    .returning({ id: accountAdjustments.id });
  if (!row) throw notFound('adjustmentNotFound');
}

/** Balance of an account just before `instant`. */
export const balanceAt = (account: TradingAccount, rows: AccountTradeRow[], instant: number) =>
  rows.reduce((sum, r) => (r.at < instant ? sum + r.pnl : sum), account.size);

/**
 * An account as of now: its size plus every closed trade assigned to it. Drawdown is measured
 * from the highest balance reached. The prop floor (lowest allowed balance) is either static,
 * size × (1 − maxDrawdownPct), or end-of-day trailing: the highest closing balance of a finished
 * day minus the limit, never above the starting size. Days are in `timeZone`.
 */
export function accountOverview(account: TradingAccount, rows: AccountTradeRow[], timeZone: string, now = new Date()) {
  const { size } = account;
  let balance = size;
  let peak = size;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const { pnl } of rows) {
    balance += pnl;
    peak = Math.max(peak, balance);
    if (peak - balance > maxDrawdown) {
      maxDrawdown = peak - balance;
      maxDrawdownPct = (maxDrawdown / peak) * 100;
    }
  }
  const pnl = balance - size;
  /** The part of the balance that comes from corrections (fees the reports leave out). */
  const adjustments = round2(rows.reduce((sum, r) => (r.adjustmentDate ? sum + r.pnl : sum), 0));

  // A limit entered as an amount is used as is; as %, it is that share of the size.
  const ddLimit = account.maxDrawdownAmount ?? (account.maxDrawdownPct != null ? (size * account.maxDrawdownPct) / 100 : null);
  const targetAmount = account.profitTargetAmount ?? (account.profitTargetPct != null ? (size * account.profitTargetPct) / 100 : null);
  const prop =
    account.type === 'prop' && ddLimit != null
      ? (() => {
          const limit = ddLimit;
          // Highest balance at the close of a finished day (today is not closed yet).
          const today = toLocalDate(now, timeZone);
          const dayOf = (r: AccountTradeRow) => toLocalDate(new Date(r.at), timeZone);
          let running = size;
          let highWater = size;
          rows.forEach((r, i) => {
            running += r.pnl;
            // Rows are in time order: the last row of a day gives its closing balance.
            const day = dayOf(r);
            const next = rows[i + 1];
            if (day < today && (!next || dayOf(next) !== day)) highWater = Math.max(highWater, running);
          });
          const floor = account.drawdownType === 'eod' ? Math.min(size, highWater - limit) : size - limit;
          const remaining = Math.max(0, balance - floor);
          const used = Math.min(limit, Math.max(0, limit - (balance - floor)));
          const target =
            targetAmount != null
              ? (() => {
                  const amount = targetAmount;
                  return {
                    pct: round2((amount / size) * 100),
                    /** How the target was entered: as % or as an amount. */
                    unit: account.profitTargetAmount != null ? ('amount' as const) : ('pct' as const),
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
            drawdownType: account.drawdownType,
            maxDrawdownPct: round2((limit / size) * 100),
            /** How the drawdown was entered: as % or as an amount. */
            drawdownUnit: account.maxDrawdownAmount != null ? ('amount' as const) : ('pct' as const),
            limit: round2(limit),
            /** Lowest allowed balance now. */
            floor: round2(floor),
            /** EOD: highest closing balance of a finished day the floor trails. */
            highWater: round2(highWater),
            used: round2(used),
            remaining: round2(remaining),
            usedPct: round2((used / limit) * 100),
            breached: balance <= floor,
          };
        })()
      : null;

  return {
    id: account.id,
    name: account.name,
    type: account.type,
    market: account.market,
    leverage: account.leverage,
    /** Own limits (null = the defaults from the settings). */
    maxTradesPerDay: account.maxTradesPerDay,
    lossStreakAlert: account.lossStreakAlert,
    /** Accounts sharing this id are linked (trades are saved on all of them); null = not linked. */
    linkGroup: account.linkGroup,
    size,
    trades: rows.filter((r) => !r.adjustmentDate).length,
    balance: round2(balance),
    pnl: round2(pnl),
    /** Of that, balance corrections (fees and commissions the trades do not show). */
    adjustments,
    returnPct: round2((pnl / size) * 100),
    currentDrawdown: round2(peak - balance),
    currentDrawdownPct: round2(((peak - balance) / peak) * 100),
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPct: round2(maxDrawdownPct),
    prop,
  };
}

export type AccountOverview = ReturnType<typeof accountOverview>;

/** Every account of the user with its current figures. */
export async function accountOverviews(db: DB, user: CurrentUser) {
  const accounts = await listAccounts(db, user);
  const [rows, counts] = await Promise.all([accountTradeRows(db, user, accounts.map((a) => a.id)), accountTradeCounts(db, user)]);
  return accounts.map((a) => ({
    ...accountOverview(a, rows.get(a.id) ?? [], user.timezone),
    /** Every trade of the account, open ones included (asked about when deleting it). */
    tradeCount: counts.get(a.id) ?? 0,
  }));
}

/** Balance before the first of `days` and after each of them. */
export function accountBalanceCurve(account: TradingAccount, rows: AccountTradeRow[], days: string[]) {
  if (days.length === 0) return null;
  const through = (day: string, inclusive: boolean) =>
    round2(rows.reduce((sum, r) => ((inclusive ? r.tradeDate <= day : r.tradeDate < day) ? sum + r.pnl : sum), account.size));
  return { start: through(days[0]!, false), points: days.map((date) => ({ date, balance: through(date, true) })) };
}
