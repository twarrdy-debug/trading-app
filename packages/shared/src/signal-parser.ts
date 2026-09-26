import type { Direction } from './enums.ts';
import { validatePriceSides } from './trade-math.ts';

export interface ParsedSignal {
  symbol: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfits: number[];
}

export type ParseSignalResult =
  | { ok: true; signal: ParsedSignal; warnings: string[] }
  | { ok: false; errors: string[] };

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;

const toNumber = (raw: string) => Number(raw.replace(',', '.'));

/**
 * Parses signals in the educator format, e.g.
 *
 *   XAUUSD - SELL
 *   IN: 4406.50
 *   SL: 4414
 *   TP1: 4390
 *   TP2:4384
 */
export function parseSignal(text: string): ParseSignalResult {
  const errors: string[] = [];

  const header = text.match(/([A-Z][A-Z0-9!._]{1,15})\s*[-–:]?\s*\b(BUY|SELL|LONG|SHORT)\b/i);
  if (!header) errors.push('Nie znaleziono instrumentu i kierunku (np. "XAUUSD - SELL")');

  const entry = text.match(new RegExp(String.raw`\b(?:IN|ENTRY|WEJŚCIE|WEJSCIE)\s*[:=@]?\s*${NUMBER}`, 'i'));
  if (!entry) errors.push('Brak ceny wejścia (IN)');

  const stop = text.match(new RegExp(String.raw`\bSL\s*[:=]?\s*${NUMBER}`, 'i'));
  if (!stop) errors.push('Brak Stop Loss (SL)');

  const takeProfits = [...text.matchAll(new RegExp(String.raw`\bTP(\d{0,2})(?:\s*[:=]\s*|\s+)${NUMBER}`, 'gi'))]
    .map((m) => ({ order: m[1] ? Number(m[1]) : 0, price: toNumber(m[2]!) }))
    .sort((a, b) => a.order - b.order)
    .map((tp) => tp.price);
  if (takeProfits.length === 0) errors.push('Brak Take Profit (TP)');

  if (errors.length > 0) return { ok: false, errors };

  const rawDirection = header![2]!.toUpperCase();
  const signal: ParsedSignal = {
    symbol: header![1]!.toUpperCase(),
    direction: rawDirection === 'BUY' || rawDirection === 'LONG' ? 'long' : 'short',
    entryPrice: toNumber(entry![1]!),
    stopLoss: toNumber(stop![1]!),
    takeProfits,
  };
  const warnings = validatePriceSides(signal.direction, signal.entryPrice, signal.stopLoss, signal.takeProfits);
  return { ok: true, signal, warnings };
}
