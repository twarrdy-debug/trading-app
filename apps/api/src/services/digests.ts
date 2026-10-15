import { createHmac, timingSafeEqual } from 'node:crypto';
import { DISCIPLINE_CHECKS, toLocalDate, zonedTimeToUtc, type EmailSubscription, type Language, type WhatsNewInput } from '@trading/shared';
import { and, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { economicEvents, emailLog, favoriteInstruments, instrumentCurrencies, trades, users } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { t } from '../i18n.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { accountOverviews } from './accounts.ts';
import { daySummaryEmail, weekAheadEmail, whatsNewEmail, type MailEvent } from './emails.ts';
import type { Mailer, MailMessage } from './mailer.ts';
import { listTrades, tradeStats } from './trades.ts';

/**
 * The regular e-mails: "the week ahead" on Sunday from 18:00 and "day summary" from 22:00 on days
 * with closed trades, both in the user's own time zone, plus "what's new" sent by an admin. Each
 * can be turned off in the settings or with the signed link in the e-mail; `email_log` makes sure
 * none goes twice. Messages are paced, because Resend accepts about two a second.
 */

const COLUMN: Record<EmailSubscription, 'emailWeekAhead' | 'emailDaySummary' | 'emailUpdates'> = {
  weekAhead: 'emailWeekAhead',
  daySummary: 'emailDaySummary',
  updates: 'emailUpdates',
};

const PACE_MS = 600;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Unsubscribe links -------------------------------------------------------

function signature(secret: string, userId: string, kind: EmailSubscription) {
  return createHmac('sha256', secret).update(`unsubscribe:${userId}:${kind}`).digest('base64url');
}

export function verifyUnsubscribe(secret: string, userId: string, kind: EmailSubscription, given: string) {
  const expected = Buffer.from(signature(secret, userId, kind));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The web page the e-mail links to, and the address mail clients POST to for one-click unsubscribe. */
function unsubscribeUrls(env: Env, userId: string, kind: EmailSubscription) {
  const query = `u=${userId}&k=${kind}&s=${signature(env.AUTH_SECRET, userId, kind)}`;
  return { page: `${env.PUBLIC_URL}/wypisz?${query}`, oneClick: `${env.PUBLIC_URL}/api/email/unsubscribe?${query}` };
}

export async function unsubscribe(db: DB, userId: string, kind: EmailSubscription) {
  await db.update(users).set({ [COLUMN[kind]]: false }).where(eq(users.id, userId));
}

// --- Formatting --------------------------------------------------------------

const localeOf = (language: Language) => (language === 'pl' ? 'pl-PL' : 'en-GB');

function money(language: Language, value: number, currency: string, sign = true) {
  const n = new Intl.NumberFormat(localeOf(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  const prefix = value < 0 ? '−' : sign && value > 0 ? '+' : '';
  return currency === 'USD' ? `${prefix}$${n}` : `${prefix}${n} ${currency}`;
}

const number = (language: Language, value: number, digits = 1) =>
  new Intl.NumberFormat(localeOf(language), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

const signed = (language: Language, value: number, digits = 1) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${number(language, Math.abs(value), digits)}`;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Wall-clock parts of an instant in a zone. */
function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), hour: Number(get('hour')), date: toLocalDate(instant, timeZone) };
}

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const time = (language: Language, instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat(localeOf(language), { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);

/** "Poniedziałek 19.10" / "Monday 19/10" for a local date. */
function dayName(language: Language, isoDate: string) {
  const weekday = new Intl.DateTimeFormat(localeOf(language), { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
  return `${capitalize(weekday)} ${isoDate.slice(8, 10)}${language === 'pl' ? '.' : '/'}${isoDate.slice(5, 7)}`;
}

/** The line at the top right: "Niedziela, 18.10 · 18:00". */
function dateline(language: Language, instant: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat(localeOf(language), { timeZone, weekday: 'long', day: '2-digit', month: '2-digit' }).format(instant);
  return `${capitalize(date)} · ${time(language, instant, timeZone)}`;
}

function zoneName(language: Language, timeZone: string) {
  const parts = new Intl.DateTimeFormat(localeOf(language), { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

function eventsCount(language: Language, n: number) {
  if (language === 'en') return `${n} ${n === 1 ? 'event' : 'events'}`;
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return `${n} ${n === 1 ? 'wydarzenie' : few ? 'wydarzenia' : 'wydarzeń'}`;
}

// --- Data --------------------------------------------------------------------

/** Currencies the user cares about: of the favourite instruments, else of recently traded ones, else USD. */
async function userCurrencies(db: DB, user: CurrentUser) {
  const favourite = await db
    .selectDistinct({ currency: instrumentCurrencies.currency })
    .from(favoriteInstruments)
    .innerJoin(instrumentCurrencies, eq(instrumentCurrencies.instrumentId, favoriteInstruments.instrumentId))
    .where(eq(favoriteInstruments.userId, user.id));
  if (favourite.length) return favourite.map((r) => r.currency).sort();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const traded = await db
    .selectDistinct({ currency: instrumentCurrencies.currency })
    .from(trades)
    .innerJoin(instrumentCurrencies, eq(instrumentCurrencies.instrumentId, trades.instrumentId))
    .where(and(eq(trades.userId, user.id), gte(trades.openedAt, since)));
  return traded.length ? traded.map((r) => r.currency).sort() : ['USD'];
}

async function importantEvents(db: DB, from: Date, to: Date, currencies: string[]) {
  return db
    .select()
    .from(economicEvents)
    .where(and(gte(economicEvents.eventTime, from), lt(economicEvents.eventTime, to), inArray(economicEvents.impact, ['high', 'medium']), inArray(economicEvents.currency, currencies)))
    .orderBy(economicEvents.eventTime);
}

const toMailEvent = (language: Language, timeZone: string) => (e: typeof economicEvents.$inferSelect): MailEvent => ({
  time: time(language, e.eventTime, timeZone),
  currency: e.currency,
  title: e.title,
  impact: e.impact === 'high' ? 'high' : 'medium',
  forecast: e.forecast || null,
  previous: e.previous || null,
});

/**
 * "The week ahead" for the coming Monday to Friday, or null when the calendar has no events for
 * that week yet (the source only publishes the current week; it turns over at the weekend).
 */
export async function buildWeekAhead(db: DB, env: Env, user: CurrentUser, now = new Date()): Promise<{ key: string; message: MailMessage } | null> {
  const l = user.language;
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const weekday = localParts(now, tz).weekday;
  const UNTIL_MONDAY: Record<string, number> = { Sun: 1, Mon: 7, Tue: 6, Wed: 5, Thu: 4, Fri: 3, Sat: 2 };
  const monday = addDays(today, UNTIL_MONDAY[weekday] ?? 1);
  const from = zonedTimeToUtc(`${monday}T00:00:00`, tz);
  const to = zonedTimeToUtc(`${addDays(monday, 5)}T00:00:00`, tz);
  const [known] = await db.select({ id: economicEvents.id }).from(economicEvents).where(and(gte(economicEvents.eventTime, from), lt(economicEvents.eventTime, to))).limit(1);
  if (!known) return null;
  const currencies = await userCurrencies(db, user);
  const events = await importantEvents(db, from, to, currencies);
  const byDay = new Map<string, MailEvent[]>();
  for (const e of events) {
    const date = toLocalDate(e.eventTime, tz);
    byDay.set(date, [...(byDay.get(date) ?? []), toMailEvent(l, tz)(e)]);
  }
  const days = [...byDay.entries()].map(([date, list]) => ({ date, name: dayName(l, date), count: eventsCount(l, list.length), events: list }));
  const busiest = days.length ? days.reduce((a, b) => (b.events.length > a.events.length ? b : a)) : null;
  const short = (date: string) =>
    capitalize(new Intl.DateTimeFormat(localeOf(l), { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)).replace('.', ''));
  const friday = addDays(monday, 4);
  const long = (date: string) => new Intl.DateTimeFormat(localeOf(l), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const range = monday.slice(5, 7) === friday.slice(5, 7) ? `${Number(monday.slice(8, 10))}–${long(friday)}` : `${long(monday)} – ${long(friday)}`;
  const urls = unsubscribeUrls(env, user.id, 'weekAhead');
  const message = weekAheadEmail({
    language: l,
    publicUrl: env.PUBLIC_URL,
    email: user.email!,
    unsubscribeUrl: urls.page,
    dateline: dateline(l, now, tz),
    range,
    currencies,
    zone: zoneName(l, tz),
    busiest: busiest ? short(busiest.date) : null,
    days,
  });
  return { key: monday, message: { ...message, unsubscribeUrl: urls.oneClick } };
}

const UNIT: Record<Language, { cfd: string; futures: string }> = { pl: { cfd: 'lot', futures: 'kontr.' }, en: { cfd: 'lot', futures: 'contr.' } };

/** "Day summary" of a local day (default: today), or null when no trade was closed that day. */
export async function buildDaySummary(db: DB, env: Env, user: CurrentUser, now = new Date(), day = toLocalDate(now, user.timezone)): Promise<{ key: string; message: MailMessage } | null> {
  const l = user.language;
  const tz = user.timezone;
  const { items } = await listTrades(db, user, { dateFrom: day, dateTo: day, status: 'closed', limit: 200, offset: 0 });
  if (items.length === 0) return null;
  const rows = [...items].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const [stats, overviews] = await Promise.all([tradeStats(db, user, { dateFrom: day, dateTo: day }), accountOverviews(db, user)]);
  const currency = user.accountCurrency;
  const pnl = rows.reduce((sum, r) => sum + (r.pnlAccount ?? 0), 0);
  const rValues = rows.map((r) => r.rMultiple).filter((r): r is number => r != null);
  const rSum = rValues.reduce((a, b) => a + b, 0);
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const accounts = accountIds.map((id) => overviews.find((o) => o.id === id)).filter((o) => o != null);
  const single = accountIds.length === 1 && accounts.length === 1 ? accounts[0]! : null;
  const limit = single ? (single.maxTradesPerDay ?? user.maxTradesPerDay) : null;
  const balanceLine = single
    ? t(l, 'dayBalance', { pct: `${signed(l, single.balance - pnl > 0 ? (pnl / (single.balance - pnl)) * 100 : 0, 2)}%`, balance: money(l, single.balance, currency, false) })
    : null;
  const winRate = stats.summary.winRate;
  const discipline = stats.equityCurve.find((d) => d.date === day)?.discipline;
  const LABEL = { limit: 'dayCheckLimit', stopLoss: 'dayCheckStop', emotions: 'dayCheckEmotions', losses: 'dayCheckLosses' } as const;
  const checks = DISCIPLINE_CHECKS.map((check) => {
    const ok = discipline?.[check] ?? true;
    return { ok, label: t(l, ok ? LABEL[check] : `${LABEL[check]}Broken`) };
  });
  const tomorrowDate = addDays(day, localParts(zonedTimeToUtc(`${day}T12:00:00`, tz), tz).weekday === 'Fri' ? 3 : 1);
  const tomorrow = await importantEvents(db, zonedTimeToUtc(`${tomorrowDate}T00:00:00`, tz), zonedTimeToUtc(`${addDays(tomorrowDate, 1)}T00:00:00`, tz), await userCurrencies(db, user));
  const urls = unsubscribeUrls(env, user.id, 'daySummary');
  const dateLabel = `${day.slice(8, 10)}${l === 'pl' ? '.' : '/'}${day.slice(5, 7)}`;
  const message = daySummaryEmail({
    language: l,
    publicUrl: env.PUBLIC_URL,
    email: user.email!,
    unsubscribeUrl: urls.page,
    dateline: dateline(l, now, tz),
    date: dateLabel,
    accountLabel: accounts.length ? accounts.map((a) => a.name).join(', ') : null,
    pnl: money(l, pnl, currency),
    positive: pnl >= 0,
    balanceLine,
    trades: limit != null ? `${rows.length} <span style="font-size:13px;font-weight:600;color:#5f6b7a">/ ${limit}</span>` : String(rows.length),
    winRate: winRate == null ? '–' : `${Math.round(winRate)}%`,
    rSum: rValues.length ? `${signed(l, rSum)}R` : '–',
    rPositive: rSum >= 0,
    rows: rows.map((r) => {
      // As many decimals as the entry was typed with (an exit in parts is an average).
      const digits = Math.min(5, String(r.entryPrice).split('.')[1]?.length ?? 0);
      const price = (v: number | null) => (v == null ? '–' : new Intl.NumberFormat(localeOf(l), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v));
      const size = new Intl.NumberFormat(localeOf(l), { maximumFractionDigits: 2 }).format(r.positionSize);
      return {
        time: time(l, r.openedAt, tz),
        long: r.direction === 'long',
        side: r.direction === 'long' ? 'Long' : 'Short',
        symbol: r.instrument.symbol,
        detail: `${size} ${UNIT[l][r.instrument.market === 'futures' ? 'futures' : 'cfd']} · ${price(r.entryPrice)} → ${price(r.exitPrice)}`,
        pnl: r.pnlAccount == null ? '–' : money(l, r.pnlAccount, currency),
        win: r.outcome === 'win' ? true : r.outcome === 'loss' ? false : null,
        r: r.rMultiple == null ? '' : `${signed(l, r.rMultiple)}R`,
      };
    }),
    checks,
    tomorrow: tomorrow.map(toMailEvent(l, tz)).filter((e) => e.impact === 'high'),
  });
  return { key: day, message: { ...message, unsubscribeUrl: urls.oneClick } };
}

// --- Sending -----------------------------------------------------------------

/** Users who can get regular e-mails: activated, not blocked, with an address. */
const recipients = (db: DB) =>
  db
    .select()
    .from(users)
    .where(and(eq(users.emailVerified, true), isNull(users.disabledAt), isNotNull(users.email)));

/** Claims kind × key for a user; false when it was sent before. The claim is dropped if sending fails. */
async function sendOnce(db: DB, mailer: Mailer, userId: string, kind: string, key: string, message: MailMessage) {
  const [claimed] = await db.insert(emailLog).values({ userId, kind, key }).onConflictDoNothing().returning({ id: emailLog.id });
  if (!claimed) return false;
  try {
    await mailer.send(message);
    return true;
  } catch (error) {
    await db.delete(emailLog).where(eq(emailLog.id, claimed.id));
    throw error;
  }
}

async function alreadySent(db: DB, userId: string, kind: string, key: string) {
  const [row] = await db.select({ id: emailLog.id }).from(emailLog).where(and(eq(emailLog.userId, userId), eq(emailLog.kind, kind), eq(emailLog.key, key)));
  return row != null;
}

/** One pass: sends whatever is due now (week ahead on Sunday from 18:00, day summary from 22:00). */
export async function runDigests(db: DB, env: Env, mailer: Mailer, log: (msg: string) => void, now = new Date()) {
  let sent = 0;
  for (const user of await recipients(db)) {
    const { weekday, hour, date } = localParts(now, user.timezone);
    const due: { kind: EmailSubscription; build: () => Promise<{ key: string; message: MailMessage } | null>; key: string }[] = [];
    if (user.emailWeekAhead && weekday === 'Sun' && hour >= 18) due.push({ kind: 'weekAhead', key: addDays(date, 1), build: () => buildWeekAhead(db, env, user, now) });
    if (user.emailDaySummary && hour >= 22) due.push({ kind: 'daySummary', key: date, build: () => buildDaySummary(db, env, user, now) });
    for (const job of due) {
      try {
        if (await alreadySent(db, user.id, job.kind, job.key)) continue;
        const built = await job.build();
        if (!built) continue;
        if (await sendOnce(db, mailer, user.id, job.kind, built.key, built.message)) {
          sent++;
          await sleep(PACE_MS);
        }
      } catch (error) {
        log(`E-mail ${job.kind} to ${user.id} failed: ${(error as Error).message}`);
      }
    }
  }
  if (sent) log(`Regular e-mails sent: ${sent}`);
  return sent;
}

export function startDigestScheduler(db: DB, env: Env, mailer: Mailer, log: (msg: string) => void, minutes = 10) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runDigests(db, env, mailer, log);
    } catch (error) {
      log(`Regular e-mails failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 60_000);
  const timer = setInterval(() => void run(), minutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/**
 * "What's new" from an admin: as a test to the admin only, or to everyone who has it on (each user
 * once per version, in the background). Returns how many it goes to.
 */
export async function sendWhatsNew(db: DB, env: Env, mailer: Mailer, admin: CurrentUser, input: WhatsNewInput, log: (msg: string) => void) {
  const date = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: admin.timezone }).format(new Date());
  const build = (user: CurrentUser) => {
    const urls = unsubscribeUrls(env, user.id, 'updates');
    const message = whatsNewEmail({ ...input, language: user.language, publicUrl: env.PUBLIC_URL, email: user.email!, unsubscribeUrl: urls.page, date });
    return { ...message, unsubscribeUrl: urls.oneClick };
  };
  if (input.test) {
    await mailer.send(build(admin));
    return { recipients: 1 };
  }
  const list = (await recipients(db)).filter((u) => u.emailUpdates);
  void (async () => {
    let sent = 0;
    for (const user of list) {
      try {
        if (await sendOnce(db, mailer, user.id, 'updates', input.version, build(user))) {
          sent++;
          await sleep(PACE_MS);
        }
      } catch (error) {
        log(`What's new to ${user.id} failed: ${(error as Error).message}`);
      }
    }
    log(`What's new ${input.version} sent to ${sent} users`);
  })();
  return { recipients: list.length };
}
