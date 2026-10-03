import type { Direction } from './enums.ts';

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function toLocalDate(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Daily trade label, e.g. "1/26.09.2025 – LONG". */
export function formatDayLabel(dayIndex: number, tradeDate: string, direction: Direction): string {
  const [year, month, day] = tradeDate.split('-');
  return `${dayIndex}/${day}.${month}.${year} – ${direction.toUpperCase()}`;
}

/** Offset of a time zone from UTC at an instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant of a wall-clock time ("2026-09-26T14:30:00") in an IANA time zone. */
export function zonedTimeToUtc(localDateTime: string, timeZone: string): Date {
  const guess = Date.parse(`${localDateTime}Z`);
  const first = zoneOffsetMs(new Date(guess), timeZone);
  const second = zoneOffsetMs(new Date(guess - first), timeZone);
  return new Date(guess - second);
}

/**
 * Time zones of trading platform servers (MT5 reports use server time).
 * `broker-ny7` is what most brokers use: GMT+2 in winter and GMT+3 in summer, following
 * US daylight saving, so that 17:00 in New York is midnight on the server.
 */
export const BROKER_TIMEZONES = ['broker-ny7', 'UTC', 'Europe/London', 'Europe/Warsaw', 'Europe/Athens'] as const;
export type BrokerTimezone = (typeof BROKER_TIMEZONES)[number];

/** Instant of a platform server time ("2026-09-26T14:30:00"). */
export function brokerTimeToUtc(localDateTime: string, zone: BrokerTimezone): Date {
  if (zone !== 'broker-ny7') return zonedTimeToUtc(localDateTime, zone);
  const newYork = new Date(Date.parse(`${localDateTime}Z`) - 7 * 3_600_000).toISOString().slice(0, 19);
  return zonedTimeToUtc(newYork, 'America/New_York');
}
