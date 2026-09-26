import type { Direction, MeasureUnit } from './enums.ts';

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
}

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
  const hasExit = trade.exitPrice != null;
  const resultUnits = hasExit ? priceToUnits(spec, trade.direction, trade.entryPrice, trade.exitPrice!) : null;
  const pnlQuote = resultUnits == null ? null : round(resultUnits * spec.unitValue * trade.positionSize, 2);
  const pnlAccount =
    pnlQuote == null || trade.fxRate == null ? null : round(pnlQuote * trade.fxRate - (trade.fees ?? 0), 2);

  const riskUnits =
    trade.stopLoss == null ? null : round(Math.abs(trade.entryPrice - trade.stopLoss) / spec.unitSize, 2);
  const rMultiple = resultUnits == null || !riskUnits ? null : round(resultUnits / riskUnits, 2);
  const plannedRR =
    trade.takeProfit == null || trade.stopLoss == null || trade.entryPrice === trade.stopLoss
      ? null
      : round(Math.abs(trade.takeProfit - trade.entryPrice) / Math.abs(trade.entryPrice - trade.stopLoss), 2);

  const spreadCost =
    trade.spreadUnits == null || trade.fxRate == null
      ? null
      : round(trade.spreadUnits * spec.unitValue * trade.positionSize * trade.fxRate, 2);

  return { resultUnits, pnlQuote, pnlAccount, riskUnits, rMultiple, plannedRR, spreadCost };
}

/** Warnings for prices on the wrong side of the entry, e.g. a long with SL above entry. */
export function validatePriceSides(
  direction: Direction,
  entry: number,
  stopLoss?: number | null,
  takeProfits: readonly number[] = [],
): string[] {
  const sign = directionSign(direction);
  const warnings: string[] = [];
  if (stopLoss != null && (stopLoss - entry) * sign >= 0) {
    warnings.push(direction === 'long' ? 'SL powinien być poniżej ceny wejścia' : 'SL powinien być powyżej ceny wejścia');
  }
  takeProfits.forEach((tp, i) => {
    if ((tp - entry) * sign <= 0) {
      warnings.push(
        `TP${i + 1} powinien być ${direction === 'long' ? 'powyżej' : 'poniżej'} ceny wejścia`,
      );
    }
  });
  return warnings;
}
