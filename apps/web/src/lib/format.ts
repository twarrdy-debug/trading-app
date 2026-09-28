/** Locale for number and date formatting; set by the i18n provider from the user's language. */
let locale = 'pl-PL';
const cache = new Map<string, Intl.NumberFormat>();

export function setFormatLocale(next: string) {
  locale = next;
}

const number = (min: number, max: number) => {
  const key = `${locale}|${min}|${max}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, format);
  }
  return format;
};

const sign = (value: number, signed: boolean) => (signed && value > 0 ? '+' : value < 0 ? '−' : '');

/** "+2 340,50" (pl) or "+2,340.50" (en) with an explicit sign. */
export const formatMoney = (value: number | null | undefined, signed = true) =>
  value == null ? '—' : `${sign(value, signed)}${number(2, 2).format(Math.abs(value))}`;

export const formatPrice = (value: number | null | undefined) => (value == null ? '—' : number(0, 6).format(value));

export const formatNumber = (value: number | null | undefined, signed = false) =>
  value == null ? '—' : `${sign(value, signed)}${number(0, 2).format(Math.abs(value))}`;

export const formatPercent = (value: number | null | undefined) => (value == null ? '—' : `${number(0, 2).format(value)}%`);

/** "+540 pip" – `unitLabel` comes from the dictionary (t.units.short). */
export const formatUnits = (value: number | null | undefined, unitLabel: string) =>
  value == null ? '—' : `${formatNumber(value, true)} ${unitLabel}`;

/** Accepts "4 406,50", "4406.5", "4,406.50" etc. Returns undefined for empty or invalid input. */
export function parseDecimal(text: string): number | undefined {
  let cleaned = text.replace(/[\s ]/g, '');
  cleaned = cleaned.includes(',') && cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  if (cleaned === '') return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** A number as the user would type it back into a field: "4406,5" (pl) or "4406.5" (en). */
export const toInputNumber = (value: number | null | undefined) =>
  value == null ? '' : locale.startsWith('pl') ? String(value).replace('.', ',') : String(value);

/** Value for <input type="datetime-local"> in the browser's time zone. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const formatDateTime = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));

/** "26.09" (pl) or "26/09" (en) from "2025-09-26". */
export const formatShortDate = (isoDate: string) =>
  `${isoDate.slice(8, 10)}${locale.startsWith('pl') ? '.' : '/'}${isoDate.slice(5, 7)}`;

/** "26.09.2025" (pl) or "26/09/2025" (en) from "2025-09-26". */
export const formatDate = (isoDate: string) => `${formatShortDate(isoDate)}${locale.startsWith('pl') ? '.' : '/'}${isoDate.slice(0, 4)}`;

/** Current formatting locale, for Intl calls in components. */
export const currentLocale = () => locale;

export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
