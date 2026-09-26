import type { MeasureUnit } from '@trading/shared';

const number = (min: number, max: number) =>
  new Intl.NumberFormat('pl-PL', { minimumFractionDigits: min, maximumFractionDigits: max });

const money = number(2, 2);
const price = number(0, 6);
const compact = number(0, 2);

/** "+2 340,50" with an explicit sign. */
export const formatMoney = (value: number | null | undefined, signed = true) =>
  value == null ? '—' : `${signed && value > 0 ? '+' : value < 0 ? '−' : ''}${money.format(Math.abs(value))}`;

export const formatPrice = (value: number | null | undefined) => (value == null ? '—' : price.format(value));

export const formatNumber = (value: number | null | undefined, signed = false) =>
  value == null ? '—' : `${signed && value > 0 ? '+' : value < 0 ? '−' : ''}${compact.format(Math.abs(value))}`;

export const formatPercent = (value: number | null | undefined) => (value == null ? '—' : `${compact.format(value)}%`);

export const UNIT_LABEL: Record<MeasureUnit, string> = { pip: 'pip', tick: 't', point: 'pkt' };
export const UNIT_NAME: Record<MeasureUnit, string> = { pip: 'Pipsy', tick: 'Ticki', point: 'Punkty' };

export const formatUnits = (value: number | null | undefined, unit: MeasureUnit) =>
  value == null ? '—' : `${formatNumber(value, true)} ${UNIT_LABEL[unit]}`;

/** Accepts "4 406,50", "4406.5" etc. Returns undefined for empty or invalid input. */
export function parseDecimal(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** Value for <input type="datetime-local"> in the browser's time zone. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

/** "26.09" from "2025-09-26". */
export const formatShortDate = (isoDate: string) => `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}`;

export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
