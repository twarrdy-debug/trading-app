import { categorizeEvent, toLocalDate, type CalendarQuery, type EventImpact } from '@trading/shared';
import { and, asc, desc, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { economicEvents, instrumentCurrencies, instruments } from '../db/schema.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

/** One row of the Forex Factory weekly feed. */
export interface FfEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

export interface CalendarSource {
  /** Events of the current week (the only range the free feed offers). */
  fetchWeek(): Promise<FfEvent[]>;
}

export const forexFactorySource: CalendarSource = {
  async fetchWeek() {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`Forex Factory ${res.status}`);
    return (await res.json()) as FfEvent[];
  },
};

const SOURCE = 'forexfactory';
const IMPACTS: Record<string, EventImpact> = { High: 'high', Medium: 'medium', Low: 'low', Holiday: 'holiday' };
/** Forex Factory blocks clients that poll too often. */
const MIN_REFRESH_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

/**
 * The whole Forex Factory week (Sunday to Sunday, New York time) around the first event,
 * with a margin that stays clear of the neighbouring weeks' events.
 */
function feedWeek(first: Date) {
  const nyDate = toLocalDate(first, 'America/New_York');
  const weekday = new Date(`${nyDate}T12:00:00Z`).getUTCDay();
  const sunday = new Date(`${nyDate}T00:00:00Z`).getTime() - weekday * DAY_MS;
  return { weekStart: new Date(sunday), weekEnd: new Date(sunday + 7 * DAY_MS + 6 * 3_600_000) };
}

const externalId = (e: FfEvent) => `${e.country}|${e.title}|${new Date(e.date).toISOString()}`;

export async function lastFetchedAt(db: DB): Promise<Date | null> {
  const [row] = await db
    .select({ fetchedAt: economicEvents.fetchedAt })
    .from(economicEvents)
    .where(eq(economicEvents.source, SOURCE))
    .orderBy(desc(economicEvents.fetchedAt))
    .limit(1);
  return row?.fetchedAt ?? null;
}

/**
 * Replaces the stored events of the feed's week with the feed: new events are added,
 * changed ones updated, and ones that disappeared (rescheduled, cancelled) removed.
 * Earlier weeks stay, so history builds up over time.
 */
export async function importWeek(db: DB, feed: FfEvent[], now = new Date()) {
  const rows = feed
    .filter((e) => IMPACTS[e.impact] && /^[A-Z]{3}$/.test(e.country))
    .map((e) => ({
      source: SOURCE,
      externalId: externalId(e),
      title: e.title,
      currency: e.country,
      impact: IMPACTS[e.impact]!,
      category: categorizeEvent(e.title),
      eventTime: new Date(e.date),
      forecast: e.forecast || null,
      previous: e.previous || null,
      fetchedAt: now,
    }));
  if (rows.length === 0) return { imported: 0, removed: 0 };

  const { weekStart, weekEnd } = feedWeek(new Date(Math.min(...rows.map((r) => r.eventTime.getTime()))));

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(economicEvents)
      .where(
        and(
          eq(economicEvents.source, SOURCE),
          gte(economicEvents.eventTime, weekStart),
          lte(economicEvents.eventTime, weekEnd),
          notInArray(
            economicEvents.externalId,
            rows.map((r) => r.externalId),
          ),
        ),
      )
      .returning({ id: economicEvents.id });
    for (const row of rows) {
      await tx
        .insert(economicEvents)
        .values(row)
        .onConflictDoUpdate({
          target: [economicEvents.source, economicEvents.externalId],
          set: {
            impact: row.impact,
            category: row.category,
            forecast: row.forecast,
            previous: row.previous,
            fetchedAt: now,
          },
        });
    }
    return { imported: rows.length, removed: removed.length };
  });
}

export type RefreshResult =
  | { status: 'updated'; imported: number; removed: number; fetchedAt: string }
  | { status: 'recent' | 'error'; message: string; fetchedAt: string | null };

export async function refreshCalendar(db: DB, source: CalendarSource, { force = false } = {}): Promise<RefreshResult> {
  const last = await lastFetchedAt(db);
  if (!force && last && Date.now() - last.getTime() < MIN_REFRESH_MS) {
    return { status: 'recent', message: 'Kalendarz był odświeżany kilka minut temu', fetchedAt: last.toISOString() };
  }
  try {
    const now = new Date();
    const result = await importWeek(db, await source.fetchWeek(), now);
    return { status: 'updated', ...result, fetchedAt: now.toISOString() };
  } catch (err) {
    return { status: 'error', message: `Nie udało się pobrać kalendarza: ${(err as Error).message}`, fetchedAt: last?.toISOString() ?? null };
  }
}

/** Events on the user's local days `from`..`to`, filtered, with the app instruments each one moves. */
export async function listEvents(db: DB, user: CurrentUser, q: CalendarQuery) {
  // Instrument filter narrows currencies to the ones mapped to that instrument.
  const mapping = await db
    .select({ currency: instrumentCurrencies.currency, symbol: instruments.symbol, instrumentId: instruments.id })
    .from(instrumentCurrencies)
    .innerJoin(instruments, eq(instruments.id, instrumentCurrencies.instrumentId))
    .where(eq(instruments.active, true))
    .orderBy(asc(instruments.symbol));
  let currencies = q.currencies;
  if (q.instrumentId) {
    const own = mapping.filter((m) => m.instrumentId === q.instrumentId).map((m) => m.currency);
    currencies = currencies ? currencies.filter((c) => own.includes(c)) : own;
  }

  const rows = await db
    .select()
    .from(economicEvents)
    .where(
      and(
        // A wider UTC window, then exact local days below.
        gte(economicEvents.eventTime, new Date(new Date(`${q.from}T00:00:00Z`).getTime() - DAY_MS)),
        lte(economicEvents.eventTime, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 2 * DAY_MS)),
        currencies ? inArray(economicEvents.currency, currencies.length ? currencies : ['---']) : undefined,
        q.impacts?.length ? inArray(economicEvents.impact, q.impacts) : undefined,
        q.categories?.length ? inArray(economicEvents.category, q.categories) : undefined,
      ),
    )
    .orderBy(asc(economicEvents.eventTime), asc(economicEvents.currency));

  const events = rows
    .map((e) => ({ ...e, localDate: toLocalDate(e.eventTime, user.timezone) }))
    .filter((e) => e.localDate >= q.from && e.localDate <= q.to)
    .map((e) => ({
      id: e.id,
      title: e.title,
      currency: e.currency,
      impact: e.impact,
      category: e.category,
      eventTime: e.eventTime,
      localDate: e.localDate,
      forecast: e.forecast,
      previous: e.previous,
      actual: e.actual,
      instruments: mapping.filter((m) => m.currency === e.currency).map((m) => m.symbol),
    }));

  const [bounds] = await db
    .select({ first: economicEvents.eventTime })
    .from(economicEvents)
    .orderBy(asc(economicEvents.eventTime))
    .limit(1);
  const [lastEvent] = await db
    .select({ last: economicEvents.eventTime })
    .from(economicEvents)
    .orderBy(desc(economicEvents.eventTime))
    .limit(1);
  const fetchedAt = await lastFetchedAt(db);

  return {
    events,
    /** Range the database has data for; outside it the calendar is empty, not quiet. */
    coverage: {
      from: bounds ? toLocalDate(bounds.first, user.timezone) : null,
      to: lastEvent ? toLocalDate(lastEvent.last, user.timezone) : null,
      fetchedAt,
    },
  };
}

/** Refreshes on start when the data is over an hour old, then every `hours` hours. */
export function startCalendarScheduler(db: DB, source: CalendarSource, hours: number, log: (msg: string) => void) {
  const run = async (force: boolean) => {
    const result = await refreshCalendar(db, source, { force });
    log(`Kalendarz Forex Factory: ${result.status}${'message' in result ? ` (${result.message})` : ''}`);
  };
  const first = setTimeout(async () => {
    const last = await lastFetchedAt(db);
    if (!last || Date.now() - last.getTime() > 3_600_000) await run(true);
  }, 5_000);
  const timer = setInterval(() => void run(true), hours * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
