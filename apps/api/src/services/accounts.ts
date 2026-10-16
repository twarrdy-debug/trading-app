import { toLocalDate, type CreateAccountInput, type UpdateAccountInput } from '@trading/shared';
import { marketName } from '../i18n.ts';
import { and, asc, count, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { instruments, tradeScreenshots, tradingAccounts, trades } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

export type TradingAccount = typeof tradingAccounts.$inferSelect;

/** A closed trade's result as it counts for an account balance. */
export interface AccountTradeRow {
  pnl: number;
  /** Close time in ms (open time for trades closed without a time). */
  at: number;
  tradeDate: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const listAccounts = (db: DB, user: CurrentUser) =>
  db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, user.id)).orderBy(asc(tradingAccounts.createdAt));

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

export async function createAccount(db: DB, user: CurrentUser, input: CreateAccountInput) {
  assertPropRules(input);
  const [row] = await db
    .insert(tradingAccounts)
    .values({ ...oneUnit(input), market: input.market ?? null, userId: user.id })
    .returning();
  return row!;
}

export async function updateAccount(db: DB, user: CurrentUser, id: string, patch: UpdateAccountInput) {
  const existing = await getAccount(db, user, id);
  assertPropRules({ ...existing, ...patch });
  const [row] = await db.update(tradingAccounts).set(oneUnit(patch)).where(eq(tradingAccounts.id, existing.id)).returning();
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
    return files;
  });
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
  for (const list of byAccount.values()) list.sort((a, b) => a.at - b.at);
  return byAccount;
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
    size,
    trades: rows.length,
    balance: round2(balance),
    pnl: round2(pnl),
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
