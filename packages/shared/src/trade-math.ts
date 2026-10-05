import type { Direction, Language, MeasureUnit, TradeOutcome } from './enums.ts';

export interface InstrumentSpec {
  measureUnit: MeasureUnit;
  /** Price move of one pip/tick/point, e.g. 0.1 for XAUUSD, 0.25 for NQ, 1 for US100. */
  unitSize: number;
  /** Value of one unit for a position size of 1 (lot or contract), in the quote currency. */
  unitValue: number;
}

export interface TradeInput {
  direction: Direction;
  entryPrice: number;
  exitPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  positionSize: number;
  /** Commissions and swaps in the account currency. */
  fees?: number | null;
  /** Quote currency -> account currency rate. Use 1 when they are the same. */
  fxRate?: number | null;
  /** Spread paid on the trade, in pips/points. Informational: fill prices already include it. */
  spreadUnits?: number | null;
  /** Planned TP1..TPn of a trade without parts; the planned RR is their average. */
  takeProfits?: readonly number[] | null;
  /**
   * The position in parts: size, the part's take profit and its close price (null while open).
   * Pips add up across the closed parts, money follows each part's size, and R is that money
   * against the risk of the whole position (entry to `stopLoss`). Without parts, `exitPrice`
   * closes the whole position.
   */
  parts?: readonly { size: number; price: number | null; takeProfit?: number | null }[] | null;
}

/** Sizes are stored with 4 decimals; anything this close to the position counts as all of it. */
const SIZE_EPSILON = 1e-6;

/** Whether the exits close the whole position. */
export const closesPosition = (exits: readonly { size: number }[], positionSize: number) =>
  exits.reduce((sum, e) => sum + e.size, 0) >= positionSize - SIZE_EPSILON;

/** Size-weighted average exit price. */
export const averageExitPrice = (exits: readonly { price: number; size: number }[]) => {
  const size = exits.reduce((sum, e) => sum + e.size, 0);
  return size > 0 ? round(exits.reduce((sum, e) => sum + e.price * e.size, 0) / size, 6) : null;
};

export interface TradeMetrics {
  /** Result in pips/ticks/points; null while the trade is open. */
  resultUnits: number | null;
  /** Profit or loss in the instrument's quote currency. */
  pnlQuote: number | null;
  /** Net profit or loss in the account currency; null without an FX rate. */
  pnlAccount: number | null;
  /** Distance from entry to stop loss in pips/ticks. */
  riskUnits: number | null;
  /** Result expressed in multiples of the initial risk. */
  rMultiple: number | null;
  /** Reward-to-risk planned at entry (TP distance / SL distance). */
  plannedRR: number | null;
  /** Cost of the spread in the account currency; null without a spread or FX rate. */
  spreadCost: number | null;
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const directionSign = (direction: Direction) => (direction === 'long' ? 1 : -1);

/** Signed pips/ticks/points between two prices for a given direction. */
export function priceToUnits(spec: InstrumentSpec, direction: Direction, from: number, to: number): number {
  return round(((to - from) * directionSign(direction)) / spec.unitSize, 2);
}

export function computeTradeMetrics(spec: InstrumentSpec, trade: TradeInput): TradeMetrics {
  const parts = trade.parts?.length ? trade.parts : null;
  const pips = (price: number) => ((price - trade.entryPrice) * directionSign(trade.direction)) / spec.unitSize;
  let resultUnits: number | null;
  let pnlQuote: number | null;
  if (parts) {
    const closed = parts.filter((p): p is typeof p & { price: number } => p.price != null);
    resultUnits = closed.length ? round(closed.reduce((sum, p) => sum + pips(p.price), 0), 2) : null;
    pnlQuote = closed.length ? round(closed.reduce((sum, p) => sum + pips(p.price) * spec.unitValue * p.size, 0), 2) : null;
  } else {
    resultUnits = trade.exitPrice != null ? priceToUnits(spec, trade.direction, trade.entryPrice, trade.exitPrice) : null;
    pnlQuote = resultUnits == null ? null : round(resultUnits * spec.unitValue * trade.positionSize, 2);
  }
  const pnlAccount =
    pnlQuote == null || trade.fxRate == null ? null : round(pnlQuote * trade.fxRate - (trade.fees ?? 0), 2);

  const riskUnits =
    trade.stopLoss == null ? null : round(Math.abs(trade.entryPrice - trade.stopLoss) / spec.unitSize, 2);
  // With parts R is money against the whole position's risk (pips add up, so they cannot be divided).
  const riskMoney = riskUnits ? riskUnits * spec.unitValue * trade.positionSize : null;
  const rMultiple = parts
    ? pnlQuote == null || !riskMoney
      ? null
      : round(pnlQuote / riskMoney, 2)
    : resultUnits == null || !riskUnits
      ? null
      : round(resultUnits / riskUnits, 2);
  const targets = trade.takeProfits?.length ? trade.takeProfits : trade.takeProfit != null ? [trade.takeProfit] : [];
  const partTargets = parts?.filter((p): p is typeof p & { takeProfit: number } => p.takeProfit != null) ?? [];
  const plannedRR = parts
    ? partTargets.length === 0 || !riskMoney
      ? null
      : round(partTargets.reduce((sum, p) => sum + Math.abs(pips(p.takeProfit)) * spec.unitValue * p.size, 0) / riskMoney, 2)
    : targets.length === 0 || trade.stopLoss == null || trade.entryPrice === trade.stopLoss
      ? null
      : round(targets.reduce((sum, tp) => sum + Math.abs(tp - trade.entryPrice), 0) / targets.length / Math.abs(trade.entryPrice - trade.stopLoss), 2);

  const spreadCost =
    trade.spreadUnits == null || trade.fxRate == null
      ? null
      : round(trade.spreadUnits * spec.unitValue * trade.positionSize * trade.fxRate, 2);

  return { resultUnits, pnlQuote, pnlAccount, riskUnits, rMultiple, plannedRR, spreadCost };
}

/** Money at risk in the quote currency: stop distance × unit value × position size. Null without a stop. */
export function riskQuote(spec: InstrumentSpec, trade: Pick<TradeInput, 'entryPrice' | 'stopLoss' | 'positionSize'>): number | null {
  if (trade.stopLoss == null) return null;
  return round((Math.abs(trade.entryPrice - trade.stopLoss) / spec.unitSize) * spec.unitValue * trade.positionSize, 2);
}

/**
 * Position value in the quote currency: price / unit size × unit value × size.
 * XAUUSD 4400, 1 lot: 4400 / 0.1 × 10 = 440 000 USD (100 oz).
 */
export const notionalQuote = (spec: InstrumentSpec, price: number, positionSize: number) =>
  round((price / spec.unitSize) * spec.unitValue * positionSize, 2);

/** CFD margin in the quote currency at the given leverage (1:leverage). */
export const marginQuote = (spec: InstrumentSpec, price: number, positionSize: number, leverage: number) =>
  round(notionalQuote(spec, price, positionSize) / leverage, 2);

/**
 * BUY (long) or SELL (short) read from a signal's levels: a stop above the entry means a sell,
 * below means a buy. Without a stop, the first take profit decides. Null when neither is given.
 */
export function detectDirection(
  entry: number,
  stopLoss?: number | null,
  takeProfits: readonly (number | null | undefined)[] = [],
): Direction | null {
  if (stopLoss != null && stopLoss !== entry) return stopLoss > entry ? 'short' : 'long';
  const tp = takeProfits.find((t): t is number => t != null && t !== entry);
  if (tp != null) return tp > entry ? 'long' : 'short';
  return null;
}

const SIDE_MESSAGES = {
  pl: {
    slBelow: 'SL powinien być poniżej ceny wejścia',
    slAbove: 'SL powinien być powyżej ceny wejścia',
    tp: (n: number, above: boolean) => `TP${n} powinien być ${above ? 'powyżej' : 'poniżej'} ceny wejścia`,
  },
  en: {
    slBelow: 'SL should be below the entry price',
    slAbove: 'SL should be above the entry price',
    tp: (n: number, above: boolean) => `TP${n} should be ${above ? 'above' : 'below'} the entry price`,
  },
};

/** Warnings for prices on the wrong side of the entry, e.g. a long with SL above entry. */
export function validatePriceSides(
  direction: Direction,
  entry: number,
  stopLoss?: number | null,
  takeProfits: readonly number[] = [],
  language: Language = 'pl',
): string[] {
  const m = SIDE_MESSAGES[language];
  const sign = directionSign(direction);
  const warnings: string[] = [];
  if (stopLoss != null && (stopLoss - entry) * sign >= 0) {
    warnings.push(direction === 'long' ? m.slBelow : m.slAbove);
  }
  takeProfits.forEach((tp, i) => {
    if ((tp - entry) * sign <= 0) warnings.push(m.tp(i + 1, direction === 'long'));
  });
  return warnings;
}

/** Results within this many R of zero count as breakeven: neither a win nor a loss. */
export const BREAKEVEN_R = 0.1;

/**
 * Win, loss or breakeven of a closed trade (null while open). Breakeven is a result within
 * ±BREAKEVEN_R; without a stop loss (no R) only a result of exactly zero.
 */
export function tradeOutcome(trade: { resultUnits?: number | null; rMultiple?: number | null }): TradeOutcome | null {
  if (trade.resultUnits == null) return null;
  if (trade.rMultiple != null && Math.abs(trade.rMultiple) <= BREAKEVEN_R) return 'breakeven';
  return trade.resultUnits > 0 ? 'win' : trade.resultUnits < 0 ? 'loss' : 'breakeven';
}

export type ExitReason = 'tp' | 'sl' | 'be';

/**
 * How a closed trade ended, for badges: breakeven (BE, see tradeOutcome), at or beyond the take
 * profit (TP), or at or beyond the stop loss (SL). Null for other manual exits and open trades.
 */
export function exitReason(trade: {
  direction: 'long' | 'short';
  exitPrice: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  resultUnits?: number | null;
  rMultiple?: number | null;
}): ExitReason | null {
  const { direction, exitPrice, stopLoss, takeProfit } = trade;
  if (exitPrice == null) return null;
  if (tradeOutcome(trade) === 'breakeven') return 'be';
  const beyond = (level: number, favourable: boolean) =>
    (direction === 'long') === favourable ? exitPrice >= level : exitPrice <= level;
  if (takeProfit != null && beyond(takeProfit, true)) return 'tp';
  if (stopLoss != null && beyond(stopLoss, false)) return 'sl';
  return null;
}

/**
 * Position size that risks `riskQuote` (quote currency) between entry and stop, rounded down to
 * `step` (0.01 lot for CFD, 1 contract for futures). Null without a stop or when even one step
 * risks more.
 */
export function sizeForRisk(spec: InstrumentSpec, entryPrice: number, stopLoss: number | null | undefined, riskQuote: number, step: number): number | null {
  if (stopLoss == null || stopLoss === entryPrice || riskQuote <= 0) return null;
  const perUnitSize = (Math.abs(entryPrice - stopLoss) / spec.unitSize) * spec.unitValue;
  const size = Math.floor(riskQuote / perUnitSize / step + 1e-9) * step;
  return size >= step ? round(size, 4) : null;
}
