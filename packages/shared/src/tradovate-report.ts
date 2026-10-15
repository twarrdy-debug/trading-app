import type { Direction } from './enums.ts';

/**
 * Reader for Tradovate's "Position History" CSV (Account Reports → Position History → download).
 * Each row is one buy fill paired with one sell fill (FIFO), not a trade: a position built with
 * several entries or closed in parts spans several rows, and one "Position ID" covers a whole day
 * on a contract. Trades are rebuilt from the fills: ordered in time, a trade runs from flat back
 * to flat. Times are in the zone set in Tradovate (the user's own time by default).
 */
export interface TradovateFill {
  id: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  /** Local time from the file, "YYYY-MM-DDTHH:mm:ss". */
  time: string;
}

export interface TradovateTrade {
  /** First entry fill id: stable across exports, used to skip trades imported before. */
  id: string;
  account: string;
  contract: string;
  direction: Direction;
  size: number;
  /** Size-weighted average of the entry fills. */
  entryPrice: number;
  openTime: string;
  /** Exits grouped by time and price: one = closed at once, more = closed in parts. */
  exits: { qty: number; price: number; time: string }[];
  entries: number;
  /** Sum of Tradovate's P/L for the trade's pairs, before commissions. */
  profit: number;
  currency: string | null;
}

const HEADERS = ['Buy Fill ID', 'Sell Fill ID', 'Paired Qty', 'Buy Price', 'Sell Price', 'Bought Timestamp', 'Sold Timestamp', 'Contract'];

/** Splits CSV text into rows of cells (quotes, doubled quotes and CRLF handled). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** True when the text looks like Tradovate's Position History export. */
export function isTradovatePositionHistory(text: string): boolean {
  const header = parseCsv(text.slice(0, 2000).split(/\r?\n/)[0] ?? '')[0] ?? [];
  const names = new Set(header.map((h) => h.trim().replace(/^﻿/, '')));
  return HEADERS.every((h) => names.has(h));
}

/** "10/12/2026 14:36:23" (month first, as Tradovate writes it) → "2026-10-12T14:36:23". */
export function parseTradovateTime(raw: string | undefined): string | null {
  const match = raw?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, mo, d, y, h, mi, s = '00'] = match;
  const pad = (n: string) => n.padStart(2, '0');
  return `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${mi}:${s}`;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Rebuilds trades (flat → flat) from the Position History rows. */
export function parseTradovatePositionHistory(text: string): TradovateTrade[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return [];
  const col = new Map(header.map((h, i) => [h.trim(), i]));
  const get = (row: string[], name: string) => row[col.get(name) ?? -1]?.trim() ?? '';
  const num = (row: string[], name: string) => {
    const value = Number(get(row, name).replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  };

  // Fills per account × contract; a fill paired with several others appears in several rows.
  const books = new Map<string, { account: string; contract: string; currency: string | null; fills: Map<string, TradovateFill>; pnl: Map<string, number> }>();
  for (const row of rows) {
    const qty = num(row, 'Paired Qty');
    const buyPrice = num(row, 'Buy Price');
    const sellPrice = num(row, 'Sell Price');
    const boughtAt = parseTradovateTime(get(row, 'Bought Timestamp'));
    const soldAt = parseTradovateTime(get(row, 'Sold Timestamp'));
    const buyId = get(row, 'Buy Fill ID');
    const sellId = get(row, 'Sell Fill ID');
    if (!qty || buyPrice == null || sellPrice == null || !boughtAt || !soldAt || !buyId || !sellId) continue;
    const account = get(row, 'Account');
    const contract = get(row, 'Contract') || get(row, 'Product');
    const key = `${account}|${contract}`;
    let book = books.get(key);
    if (!book) {
      book = { account, contract, currency: get(row, 'Currency') || null, fills: new Map(), pnl: new Map() };
      books.set(key, book);
    }
    const add = (id: string, side: 'buy' | 'sell', price: number, time: string) => {
      const fill = book.fills.get(id);
      if (fill) fill.qty += qty;
      else book.fills.set(id, { id, side, qty, price, time });
    };
    add(buyId, 'buy', buyPrice, boughtAt);
    add(sellId, 'sell', sellPrice, soldAt);
    // P/L is booked on the pair's later fill, which is always the closing one.
    const closing = boughtAt > soldAt || (boughtAt === soldAt && BigInt(buyId) > BigInt(sellId)) ? buyId : sellId;
    book.pnl.set(closing, (book.pnl.get(closing) ?? 0) + (num(row, 'P/L') ?? 0));
  }

  const trades: TradovateTrade[] = [];
  for (const book of books.values()) {
    // Fill ids grow with time; they order fills within the same second.
    const fills = [...book.fills.values()].sort((a, b) => a.time.localeCompare(b.time) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    let net = 0;
    let current: { trade: TradovateTrade; cost: number } | null = null;
    for (const fill of fills) {
      let qty = fill.qty;
      const sign = fill.side === 'buy' ? 1 : -1;
      while (qty > 0) {
        if (!current) {
          current = {
            trade: {
              id: fill.id,
              account: book.account,
              contract: book.contract,
              direction: sign > 0 ? 'long' : 'short',
              size: 0,
              entryPrice: 0,
              openTime: fill.time,
              exits: [],
              entries: 0,
              profit: 0,
              currency: book.currency,
            },
            cost: 0,
          };
        }
        const { trade } = current;
        const adds = (trade.direction === 'long') === (sign > 0);
        if (adds) {
          trade.size += qty;
          trade.entries += 1;
          current.cost += qty * fill.price;
          net += sign * qty;
          qty = 0;
        } else {
          // Closes up to the open size; whatever is left opens the opposite way (a reversal).
          const closes = Math.min(qty, Math.abs(net));
          const last = trade.exits.at(-1);
          if (last && last.time === fill.time && last.price === fill.price) last.qty += closes;
          else trade.exits.push({ qty: closes, price: fill.price, time: fill.time });
          trade.profit += book.pnl.get(fill.id) ?? 0;
          book.pnl.delete(fill.id);
          net += sign * closes;
          qty -= closes;
          if (net === 0) {
            trade.entryPrice = round(current.cost / trade.size);
            trade.profit = Math.round(trade.profit * 100) / 100;
            trades.push(trade);
            current = null;
          }
        }
      }
    }
    // A position still open at the end of the file is left out: only closed trades are imported.
  }
  return trades.sort((a, b) => a.openTime.localeCompare(b.openTime));
}
