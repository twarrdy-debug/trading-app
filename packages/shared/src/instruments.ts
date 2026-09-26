/** Other names educators and brokers use for the same instrument. */
const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: 'XAUUSD',
  NAS100: 'US100',
  NDX: 'US100',
  USTEC: 'US100',
  US100: 'US100',
  DJ30: 'US30',
  DJI: 'US30',
  WS30: 'US30',
  SP500: 'US500',
  SPX500: 'US500',
  SPX: 'US500',
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
