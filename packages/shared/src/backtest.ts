import type { Candle } from './analysis.ts';
import type { Direction } from './enums.ts';

/** An open simulated position as the replay checks it. */
export interface ReplayPosition {
  direction: Direction;
  stopLoss: number | null;
  takeProfit: number | null;
}

/**
 * Whether a newly shown candle closes the position, and at what price. A candle that reaches both
 * levels counts as the stop (the safe assumption: the candle does not say which came first), and a
 * candle opening beyond a level fills at its open (a gap), as a stop order would.
 */
export function fillOnCandle(position: ReplayPosition, candle: Candle): { price: number; reason: 'sl' | 'tp' } | null {
  const { stopLoss: sl, takeProfit: tp } = position;
  if (position.direction === 'long') {
    if (sl != null && candle.low <= sl) return { price: Math.min(candle.open, sl), reason: 'sl' };
    if (tp != null && candle.high >= tp) return { price: Math.max(candle.open, tp), reason: 'tp' };
  } else {
    if (sl != null && candle.high >= sl) return { price: Math.max(candle.open, sl), reason: 'sl' };
    if (tp != null && candle.low <= tp) return { price: Math.min(candle.open, tp), reason: 'tp' };
  }
  return null;
}
