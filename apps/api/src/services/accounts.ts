import { toLocalDate, type CreateAccountInput, type UpdateAccountInput } from '@trading/shared';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { tradingAccounts, trades } from '../db/schema.ts';
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

/** Prop accounts need a market and a maximum drawdown; checked on the account as it will be saved. */
function assertPropRules(account: Partial<CreateAccountInput>) {
  if (account.type !== 'prop') return;
  if (!account.market) throw badRequest('validation.propMarket');
  if (account.maxDrawdownPct == null) throw badRequest('validation.propDrawdown');
}

export async function createAccount(db: DB, user: CurrentUser, input: CreateAccountInput) {
  const [row] = await db
    .insert(tradingAccounts)
    .values({ ...input, market: input.market ?? null, userId: user.id })
    .returning();
  return row!;
}

export async function updateAccount(db: DB, user: CurrentUser, id: string, patch: UpdateAccountInput) {
  const existing = await getAccount(db, user, id);
  assertPropRules({ ...existing, ...patch });
  const [row] = await db.update(tradingAccounts).set(patch).where(eq(tradingAccounts.id, existing.id)).returning();
  return row!;
}

/** Deletes the account; its trades stay in the journal without an account. */
export async function deleteAccount(db: DB, user: CurrentUser, id: string) {
  const existing = await getAccount(db, user, id);
  await db.delete(tradingAccounts).where(eq(tradingAccounts.id, existing.id));
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

  const prop =
    account.type === 'prop' && account.maxDrawdownPct != null
      ? (() => {
          const limit = (size * account.maxDrawdownPct) / 100;
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
            account.profitTargetPct != null
              ? (() => {
                  const amount = (size * account.profitTargetPct) / 100;
                  return {
                    pct: account.profitTargetPct,
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
            maxDrawdownPct: account.maxDrawdownPct,
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
  const rows = await accountTradeRows(db, user, accounts.map((a) => a.id));
  return accounts.map((a) => accountOverview(a, rows.get(a.id) ?? [], user.timezone));
}

/** Balance before the first of `days` and after each of them. */
export function accountBalanceCurve(account: TradingAccount, rows: AccountTradeRow[], days: string[]) {
  if (days.length === 0) return null;
  const through = (day: string, inclusive: boolean) =>
    round2(rows.reduce((sum, r) => ((inclusive ? r.tradeDate <= day : r.tradeDate < day) ? sum + r.pnl : sum), account.size));
  return { start: through(days[0]!, false), points: days.map((date) => ({ date, balance: through(date, true) })) };
}
