import type { Language } from './enums.ts';

/** Other names educators and brokers use for the same instrument. */
const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: 'XAUUSD',
  NAS100: 'US100',
  NDX: 'US100',
  NDX100: 'US100',
  USA100: 'US100',
  USTEC: 'US100',
  US100: 'US100',
  DJ30: 'US30',
  DJI: 'US30',
  WS30: 'US30',
  SP500: 'US500',
  SPX500: 'US500',
  SPX: 'US500',
  USA500: 'US500',
  US500: 'US500',
  USA30: 'US30',
  US30: 'US30',
  NQ: 'NQ1',
  MNQ: 'MNQ1',
  ES: 'ES1',
  MES: 'MES1',
  YM: 'YM1',
  MYM: 'MYM1',
  GC: 'GC1',
  MGC: 'MGC1',
};

/** Normalizes a symbol as written in a signal ("NQ1!", "nas100") to the stored symbol. */
export function normalizeSymbol(raw: string): string {
  const symbol = raw.toUpperCase().replace(/!$/, '');
  return SYMBOL_ALIASES[symbol] ?? symbol;
}

/** Futures month codes, as in NQZ24 or MGCG5. */
const FUTURES_CONTRACT = /^(M?NQ|M?ES|M?YM|M?GC)[FGHJKMNQUVXZ]\d{1,2}$/;

/**
 * Candidate app symbols for a broker symbol from a platform export (MT5):
 * "US100.cash", "XAUUSDm", "NAS100_i", "NQZ24" …
 */
export function brokerSymbolCandidates(raw: string): string[] {
  const upper = raw.trim().toUpperCase();
  const base = upper.split(/[._#@]/)[0] ?? upper;
  const noSuffix = base.replace(/(CASH|PRO|ECN|RAW|STD|\+|-|M)$/, '');
  const contract = base.match(FUTURES_CONTRACT)?.[1];
  const names = [upper, base, noSuffix, ...(contract ? [contract] : [])];
  return [...new Set(names.flatMap((s) => [s, normalizeSymbol(s)]))];
}

/** The instrument a broker symbol most likely refers to, if any. */
export function matchBrokerSymbol<T extends { symbol: string }>(raw: string, instruments: readonly T[]): T | undefined {
  for (const candidate of brokerSymbolCandidates(raw)) {
    const found = instruments.find((i) => i.symbol === candidate);
    if (found) return found;
  }
  return undefined;
}

/** CFD and futures quoting the same underlying. Mini and micro contracts share one price. */
export interface CfdFuturesPair {
  key: string;
  label: Record<Language, string>;
  cfd: string;
  mini: string;
  micro: string;
  /** Alert when the measured futures − CFD difference moves by more than this many points. */
  alertPoints: number;
}

export const CFD_FUTURES_PAIRS: readonly CfdFuturesPair[] = [
  { key: 'nasdaq', label: { pl: 'Nasdaq 100', en: 'Nasdaq 100' }, cfd: 'US100', mini: 'NQ1', micro: 'MNQ1', alertPoints: 10 },
  { key: 'sp500', label: { pl: 'S&P 500', en: 'S&P 500' }, cfd: 'US500', mini: 'ES1', micro: 'MES1', alertPoints: 3 },
  { key: 'dow', label: { pl: 'Dow Jones', en: 'Dow Jones' }, cfd: 'US30', mini: 'YM1', micro: 'MYM1', alertPoints: 30 },
  { key: 'gold', label: { pl: 'Złoto', en: 'Gold' }, cfd: 'XAUUSD', mini: 'GC1', micro: 'MGC1', alertPoints: 2 },
];

/** The pair a symbol belongs to, on either side ("NAS100", "NQ1!", "MGC1" …). */
export function findPairBySymbol(raw: string): { pair: CfdFuturesPair; side: 'cfd' | 'futures' } | null {
  const symbol = normalizeSymbol(raw);
  for (const pair of CFD_FUTURES_PAIRS) {
    if (pair.cfd === symbol) return { pair, side: 'cfd' };
    if (pair.mini === symbol || pair.micro === symbol) return { pair, side: 'futures' };
  }
  return null;
}

/**
 * The basis between the two markets, from prices read at the same moment.
 * `offset` shifts levels by the point difference (best intraday); `ratio` scales them
 * by the price ratio (keeps percentage distances, better for levels far from price).
 */
export interface Basis {
  cfdPrice: number;
  futuresPrice: number;
}

export type BasisMethod = 'offset' | 'ratio';

export function convertLevel(price: number, basis: Basis, to: 'cfd' | 'futures', method: BasisMethod): number {
  const { cfdPrice, futuresPrice } = basis;
  if (method === 'offset') return to === 'futures' ? price + (futuresPrice - cfdPrice) : price - (futuresPrice - cfdPrice);
  return to === 'futures' ? price * (futuresPrice / cfdPrice) : price * (cfdPrice / futuresPrice);
}

/** Rounds to the nearest multiple of `step` (e.g. a 0.25 tick) without float noise. */
export function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}
