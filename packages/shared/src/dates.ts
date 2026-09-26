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
