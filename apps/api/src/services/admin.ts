import type { AdminUpdateUserInput, UpdateInstrumentInput } from '@trading/shared';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, count, desc, eq, gte, isNotNull, max, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import {
  authSessions,
  economicEvents,
  instrumentCurrencies,
  instruments,
  invites,
  newsItems,
  strategies,
  tradeScreenshots,
  trades,
  tradingAccounts,
  users,
} from '../db/schema.ts';
import { HttpError, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { basisOverview } from './basis.ts';
import { lastFetchedAt } from './calendar.ts';
import type { NewsHub } from './news.ts';

const DAY_MS = 86_400_000;
const STARTED_AT = new Date();

// --- Users -----------------------------------------------------------------------------

/** Every account with what an admin needs to judge it: activity, usage and status. */
export async function listUsers(db: DB) {
  const tradeCounts = db
    .select({ userId: trades.userId, n: count().as('trade_count'), lastTradeAt: max(trades.createdAt).as('last_trade_at') })
    .from(trades)
    .groupBy(trades.userId)
    .as('t');
  const accountCounts = db.select({ userId: tradingAccounts.userId, n: count().as('account_count') }).from(tradingAccounts).groupBy(tradingAccounts.userId).as('a');
  const strategyCounts = db.select({ userId: strategies.userId, n: count().as('strategy_count') }).from(strategies).groupBy(strategies.userId).as('s');
  const sessions = db
    .select({
      userId: authSessions.userId,
      lastSeenAt: max(authSessions.updatedAt).as('last_seen_at'),
      active: sql<number>`count(*) filter (where ${authSessions.expiresAt} > now())`.as('active_sessions'),
    })
    .from(authSessions)
    .groupBy(authSessions.userId)
    .as('se');

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      language: users.language,
      accountCurrency: users.accountCurrency,
      createdAt: users.createdAt,
      onboardedAt: users.onboardedAt,
      disabledAt: users.disabledAt,
      signupCode: users.signupCode,
      trades: sql<number>`coalesce(${tradeCounts.n}, 0)`.mapWith(Number),
      lastTradeAt: tradeCounts.lastTradeAt,
      accounts: sql<number>`coalesce(${accountCounts.n}, 0)`.mapWith(Number),
      strategies: sql<number>`coalesce(${strategyCounts.n}, 0)`.mapWith(Number),
      lastSeenAt: sessions.lastSeenAt,
      activeSessions: sql<number>`coalesce(${sessions.active}, 0)`.mapWith(Number),
      hasPassword: sql<boolean>`exists (select 1 from auth_accounts aa where aa.user_id = ${users.id} and aa.provider_id = 'credential')`,
    })
    .from(users)
    .leftJoin(tradeCounts, eq(tradeCounts.userId, users.id))
    .leftJoin(accountCounts, eq(accountCounts.userId, users.id))
    .leftJoin(strategyCounts, eq(strategyCounts.userId, users.id))
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .orderBy(desc(users.createdAt));

  return rows.map((r) => ({
    ...r,
    // Seeded educators without e-mail and the dev admin before login have no password.
    canSignIn: Boolean(r.email && r.hasPassword),
  }));
}

export type AdminUser = Awaited<ReturnType<typeof listUsers>>[number];

async function getUser(db: DB, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) throw notFound('userNotFound');
  return row;
}

const notSelf = (admin: CurrentUser, id: string) => {
  if (admin.id === id) throw new HttpError(400, 'adminSelf');
};

/** Role change or block/unblock. Blocking also signs the user out everywhere. */
export async function updateUser(db: DB, admin: CurrentUser, id: string, patch: AdminUpdateUserInput) {
  notSelf(admin, id);
  await getUser(db, id);
  await db
    .update(users)
    .set({
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.disabled === undefined ? {} : { disabledAt: patch.disabled ? new Date() : null }),
    })
    .where(eq(users.id, id));
  if (patch.disabled) await revokeSessions(db, id);
  return (await listUsers(db)).find((u) => u.id === id)!;
}

/** Signs the user out on every device. */
export async function revokeSessions(db: DB, id: string) {
  await getUser(db, id);
  const removed = await db.delete(authSessions).where(eq(authSessions.userId, id)).returning({ id: authSessions.id });
  return { revoked: removed.length };
}

/**
 * Deletes the account with everything it owns (trades, accounts, strategies…, by cascade) and its
 * screenshot files. An educator still linked to signals or other users' trades cannot be deleted.
 */
export async function deleteUser(db: DB, admin: CurrentUser, id: string, uploadDir: string) {
  notSelf(admin, id);
  await getUser(db, id);
  const files = await db
    .select({ key: tradeScreenshots.storageKey })
    .from(tradeScreenshots)
    .innerJoin(trades, eq(trades.id, tradeScreenshots.tradeId))
    .where(eq(trades.userId, id));
  try {
    await db.delete(users).where(eq(users.id, id));
  } catch (err) {
    // 23503: a foreign key still points at the user (signals, or trades credited to an educator).
    if ((err as { code?: string; cause?: { code?: string } }).code === '23503' || (err as { cause?: { code?: string } }).cause?.code === '23503') {
      throw new HttpError(409, 'userLinked');
    }
    throw err;
  }
  await Promise.all(files.map((f) => rm(path.join(uploadDir, f.key), { force: true })));
  return { deleted: true, files: files.length };
}

// --- Statistics ------------------------------------------------------------------------

/** Counts for the admin overview: users, activity, trades, sign-ups per week and group codes. */
export async function appStats(db: DB) {
  const now = Date.now();
  const since = (days: number) => new Date(now - days * DAY_MS);
  const activeSince = (days: number) =>
    db
      .select({ n: sql<number>`count(distinct ${authSessions.userId})`.mapWith(Number) })
      .from(authSessions)
      .where(gte(authSessions.updatedAt, since(days)));

  const [[userTotals], byRole, [active7], [active30], [tradeTotals], [accountTotal], [strategyTotal], weekly, codes, bySignupCode] = await Promise.all([
    db
      .select({
        total: count(),
        new7: sql<number>`count(*) filter (where ${users.createdAt} >= ${since(7)})`.mapWith(Number),
        new30: sql<number>`count(*) filter (where ${users.createdAt} >= ${since(30)})`.mapWith(Number),
        disabled: sql<number>`count(*) filter (where ${users.disabledAt} is not null)`.mapWith(Number),
        onboardingPending: sql<number>`count(*) filter (where ${users.onboardedAt} is null)`.mapWith(Number),
      })
      .from(users),
    db.select({ role: users.role, n: count() }).from(users).groupBy(users.role).orderBy(asc(users.role)),
    activeSince(7),
    activeSince(30),
    db
      .select({
        total: count(),
        last7: sql<number>`count(*) filter (where ${trades.createdAt} >= ${since(7)})`.mapWith(Number),
        last30: sql<number>`count(*) filter (where ${trades.createdAt} >= ${since(30)})`.mapWith(Number),
        imported: sql<number>`count(*) filter (where ${trades.externalId} is not null)`.mapWith(Number),
      })
      .from(trades),
    db.select({ n: count() }).from(tradingAccounts),
    db.select({ n: count() }).from(strategies),
    // Sign-ups per week (Monday start), the last 8 weeks.
    db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${users.createdAt}), 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(users)
      .where(gte(users.createdAt, since(56)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ code: invites.code, role: invites.role, useCount: invites.useCount, expiresAt: invites.expiresAt })
      .from(invites)
      .where(eq(invites.multiUse, true))
      .orderBy(desc(invites.useCount)),
    db.select({ code: users.signupCode, n: count() }).from(users).where(isNotNull(users.signupCode)).groupBy(users.signupCode),
  ]);

  return {
    users: { ...userTotals!, active7: active7!.n, active30: active30!.n, byRole },
    trades: tradeTotals!,
    accounts: accountTotal!.n,
    strategies: strategyTotal!.n,
    signupsPerWeek: weekly,
    groupCodes: codes.map((c) => ({ ...c, signups: bySignupCode.find((s) => s.code === c.code)?.n ?? c.useCount })),
  };
}

// --- System status ---------------------------------------------------------------------

/** The deployed commit: APP_VERSION, or a VERSION file at the repository root (written on deploy). */
function appVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return readFileSync(path.resolve(process.cwd(), '../../VERSION'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Raw query rows from either driver: postgres.js returns an array, PGlite `{ rows }`. */
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];

interface SystemContext {
  db: DB;
  newsHub: NewsHub;
  env: { NODE_ENV: string; REGISTRATION: string; SMTP_URL?: string; MAIL_FROM: string; NEWS_INTERVAL_SECONDS: number; CALENDAR_INTERVAL_HOURS: number; BASIS_INTERVAL_HOURS: number };
}

/** Health of everything that runs in the background, for the admin status page. */
export async function systemStatus({ db, newsHub, env }: SystemContext) {
  const [[migrations], [dbSize], [news], calendarFetched, [calendarWeek], basis] = await Promise.all([
    db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).then((r) => rowsOf<{ n: number }>(r)),
    db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size`).then((r) => rowsOf<{ size: string }>(r)),
    db
      .select({
        latest: max(newsItems.publishedAt),
        last24h: sql<number>`count(*) filter (where ${newsItems.publishedAt} >= now() - interval '24 hours')`.mapWith(Number),
        total: count(),
      })
      .from(newsItems),
    lastFetchedAt(db),
    db
      .select({ n: count() })
      .from(economicEvents)
      .where(and(gte(economicEvents.eventTime, new Date(Date.now() - 3 * DAY_MS)), sql`${economicEvents.eventTime} < now() + interval '4 days'`)),
    basisOverview(db),
  ]);

  return {
    app: {
      version: appVersion(),
      environment: env.NODE_ENV,
      registration: env.REGISTRATION,
      startedAt: STARTED_AT,
      node: process.version,
    },
    database: { migrations: Number(migrations?.n ?? 0), size: dbSize?.size ?? null },
    mail: { configured: Boolean(env.SMTP_URL), from: env.MAIL_FROM },
    news: {
      enabled: newsHub.enabled,
      intervalSeconds: env.NEWS_INTERVAL_SECONDS,
      mode: newsHub.mode,
      lastSuccessAt: newsHub.lastSuccessAt,
      lastError: newsHub.lastError,
      openStreams: newsHub.subscribers,
      latestHeadlineAt: news?.latest ?? null,
      last24h: news?.last24h ?? 0,
      total: news?.total ?? 0,
    },
    calendar: { intervalHours: env.CALENDAR_INTERVAL_HOURS, lastFetchedAt: calendarFetched, eventsAroundToday: calendarWeek?.n ?? 0 },
    basis: {
      intervalHours: env.BASIS_INTERVAL_HOURS,
      pairs: basis.map((p) => ({ pairKey: p.pairKey, measuredAt: p.latest?.measuredAt ?? null, live: p.latest?.live ?? false, lastLiveAt: p.latestLive?.measuredAt ?? null })),
    },
  };
}

// --- Instruments -----------------------------------------------------------------------

/** All instruments, inactive ones included, with their calendar currencies and trade counts. */
export async function listAllInstruments(db: DB) {
  const [rows, currencyRows, usage] = await Promise.all([
    db.select().from(instruments).orderBy(asc(instruments.market), asc(instruments.symbol)),
    db.select().from(instrumentCurrencies),
    db.select({ instrumentId: trades.instrumentId, n: count() }).from(trades).groupBy(trades.instrumentId),
  ]);
  return rows.map((i) => ({
    ...i,
    currencies: currencyRows.filter((c) => c.instrumentId === i.id).map((c) => c.currency),
    trades: usage.find((u) => u.instrumentId === i.id)?.n ?? 0,
  }));
}

/**
 * Edits an instrument. Unit size and value only affect trades saved afterwards: the derived columns
 * of existing trades keep the values they were computed with.
 */
export async function updateInstrument(db: DB, id: string, patch: UpdateInstrumentInput) {
  const { currencies, ...fields } = patch;
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ id: instruments.id }).from(instruments).where(eq(instruments.id, id));
    if (!row) throw notFound();
    if (Object.keys(fields).length > 0) await tx.update(instruments).set(fields).where(eq(instruments.id, id));
    if (currencies) {
      await tx.delete(instrumentCurrencies).where(eq(instrumentCurrencies.instrumentId, id));
      if (currencies.length > 0) await tx.insert(instrumentCurrencies).values([...new Set(currencies)].map((currency) => ({ instrumentId: id, currency })));
    }
  });
  return (await listAllInstruments(db)).find((i) => i.id === id)!;
}
