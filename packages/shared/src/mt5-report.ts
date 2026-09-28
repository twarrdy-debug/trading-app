import type { Direction } from './enums.ts';

/**
 * Reader for the MetaTrader 5 account history report (Toolbox → History → Report → HTML or
 * Open XML). Only the "Positions" section is used: one row per closed position with open and
 * close time and price. Rows are recognised by shape, not by header text, so reports from
 * terminals in any language work.
 *
 * Position row: Time | Position | Symbol | Type | Volume | Price | S/L | T/P | Time | Price |
 *               Commission | Swap | Profit
 */
export interface Mt5Position {
  position: string;
  symbol: string;
  direction: Direction;
  volume: number;
  /** Server time, "YYYY-MM-DDTHH:mm:ss". */
  openTime: string;
  openPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  closeTime: string;
  closePrice: number;
  /** Account currency; negative is a cost. */
  commission: number;
  swap: number;
  profit: number;
}

export interface Mt5Report {
  /** Account number from the report header, when found. */
  account: string | null;
  /** Account currency from the report header, when found. */
  currency: string | null;
  positions: Mt5Position[];
}

const BUY = new Set(['buy', 'kupno', 'kup']);
const SELL = new Set(['sell', 'sprzedaż', 'sprzedaz', 'sprzedaj']);
const DATE = /^(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "1 234.56", "−12,5", "0.10" → number; empty → null. */
export function parseReportNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let text = raw.replace(/[\s ]/g, '').replace(/[−–]/g, '-');
  if (text === '') return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/,/g, '');
  else text = text.replace(',', '.');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** "2026.09.26 14:30:05" (or an Excel serial day number) → "2026-09-26T14:30:05". */
export function parseReportDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const match = text.match(DATE);
  if (match) {
    const [, y, mo, d, h, mi, s = '00'] = match;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 30_000 && serial < 80_000) {
    const ms = Math.round((serial - 25_569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 19);
  }
  return null;
}

function positionFromRow(row: string[]): Mt5Position | null {
  if (row.length < 13) return null;
  const [openRaw, position, symbol, typeRaw, volumeRaw, openPriceRaw, slRaw, tpRaw, closeRaw, closePriceRaw, commissionRaw, swapRaw, profitRaw] =
    row.map((c) => c.trim());
  const openTime = parseReportDate(openRaw);
  const closeTime = parseReportDate(closeRaw);
  const type = typeRaw!.toLowerCase();
  const direction: Direction | null = BUY.has(type) ? 'long' : SELL.has(type) ? 'short' : null;
  const volume = parseReportNumber(volumeRaw);
  const openPrice = parseReportNumber(openPriceRaw);
  const closePrice = parseReportNumber(closePriceRaw);
  const profit = parseReportNumber(profitRaw);
  if (!openTime || !closeTime || !direction || !/^\d+$/.test(position!) || !symbol) return null;
  if (volume == null || volume <= 0 || openPrice == null || openPrice <= 0 || closePrice == null || closePrice <= 0 || profit == null) {
    return null;
  }
  const level = (raw: string | undefined) => {
    const value = parseReportNumber(raw);
    return value != null && value > 0 ? value : null;
  };
  return {
    position: position!,
    symbol,
    direction,
    volume,
    openTime,
    openPrice,
    stopLoss: level(slRaw),
    takeProfit: level(tpRaw),
    closeTime,
    closePrice,
    commission: parseReportNumber(commissionRaw) ?? 0,
    swap: parseReportNumber(swapRaw) ?? 0,
    profit,
  };
}

/** Account number and currency from a header row like "Account: | 12345678 (USD, Broker-Server, real, Hedge)". */
function accountFromRows(rows: string[][]): Pick<Mt5Report, 'account' | 'currency'> {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (!/^(account|konto|счёт|счет|conta|cuenta|konto nr)\s*:?$/i.test(row[i]!.trim())) continue;
      const value = row.slice(i + 1).find((c) => c.trim() !== '') ?? '';
      const account = value.match(/\d{3,}/)?.[0] ?? null;
      const currency = value.match(/\(\s*([A-Z]{3})\b/)?.[1] ?? null;
      if (account) return { account, currency };
    }
  }
  return { account: null, currency: null };
}

/** Positions from the rows of a report (HTML table rows or spreadsheet rows). */
export function parseMt5Rows(rows: string[][]): Mt5Report {
  const positions: Mt5Position[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const position = positionFromRow(row);
    if (position && !seen.has(position.position)) {
      seen.add(position.position);
      positions.push(position);
    }
  }
  return { ...accountFromRows(rows), positions };
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** Table rows of an HTML document as cell texts. Cells with class "hidden" are skipped. */
export function htmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells: string[] = [];
    for (const cell of tr[1]!.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
      if (/\bclass\s*=\s*["']?[^"'>]*\bhidden\b/i.test(cell[2]!)) continue;
      const text = cell[3]!.replace(/<\/t[dh]>[\s\S]*$/i, '').replace(/<[^>]*>/g, '');
      cells.push(decodeEntities(text).replace(/\s+/g, ' ').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** MT5 writes HTML reports as UTF-16 LE with a BOM; other tools use UTF-8. */
export function decodeReportText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

export const parseMt5Html = (html: string): Mt5Report => parseMt5Rows(htmlTableRows(html));
