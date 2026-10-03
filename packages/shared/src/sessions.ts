import { toLocalDate, zonedTimeToUtc } from './dates.ts';

/**
 * The four FX trading sessions, each as local business hours in its own city, so daylight saving
 * in every zone is handled by the time zone database. Sessions run Monday to Friday local time
 * (Sydney's Monday morning is Sunday evening in Europe, as on the real market).
 */
export const MARKET_SESSIONS = [
  { key: 'sydney', zone: 'Australia/Sydney', open: '07:00', close: '16:00' },
  { key: 'tokyo', zone: 'Asia/Tokyo', open: '09:00', close: '18:00' },
  { key: 'london', zone: 'Europe/London', open: '08:00', close: '17:00' },
  { key: 'newyork', zone: 'America/New_York', open: '08:00', close: '17:00' },
] as const;

export type SessionKey = (typeof MARKET_SESSIONS)[number]['key'];

export interface SessionWindow {
  start: Date;
  end: Date;
}

export interface SessionState {
  key: SessionKey;
  open: boolean;
  /** The window open now, or else the next one. */
  current: SessionWindow;
  /** Windows overlapping the given day (for drawing a 24-hour bar). */
  today: SessionWindow[];
}

const DAY_MS = 86_400_000;

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const isWeekend = (isoDate: string) => [0, 6].includes(new Date(`${isoDate}T12:00:00Z`).getUTCDay());

/** Weekday windows of a session around a date in its own zone. */
function windows(session: (typeof MARKET_SESSIONS)[number], around: Date, daysBack: number, daysForward: number): SessionWindow[] {
  const localToday = toLocalDate(around, session.zone);
  const result: SessionWindow[] = [];
  for (let d = -daysBack; d <= daysForward; d++) {
    const date = addDays(localToday, d);
    if (isWeekend(date)) continue;
    result.push({ start: zonedTimeToUtc(`${date}T${session.open}:00`, session.zone), end: zonedTimeToUtc(`${date}T${session.close}:00`, session.zone) });
  }
  return result;
}

/** The day (00:00 to the next 00:00) of `now` in the user's time zone. */
export function localDayBounds(now: Date, timeZone: string): SessionWindow {
  const date = toLocalDate(now, timeZone);
  return { start: zonedTimeToUtc(`${date}T00:00:00`, timeZone), end: zonedTimeToUtc(`${addDays(date, 1)}T00:00:00`, timeZone) };
}

/** Open or closed, the current or next window, and today's windows, for every session. */
export function marketSessions(now: Date, timeZone: string): SessionState[] {
  const day = localDayBounds(now, timeZone);
  return MARKET_SESSIONS.map((session) => {
    // Four days forward reaches Monday from a Friday evening.
    const all = windows(session, now, 2, 4);
    const openWindow = all.find((w) => w.start <= now && now < w.end);
    const next = all.find((w) => w.start > now)!;
    return {
      key: session.key,
      open: Boolean(openWindow),
      current: openWindow ?? next,
      today: all.filter((w) => w.end > day.start && w.start < day.end),
    };
  });
}
