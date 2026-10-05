import { describe, expect, it } from 'vitest';
import { computeTradeMetrics, detectDirection, exitReason, tradeOutcome, formatDayLabel, marginQuote, notionalQuote, riskQuote, parseSignal, toLocalDate, type InstrumentSpec } from '../src/index.ts';

const XAUUSD: InstrumentSpec = { measureUnit: 'pip', unitSize: 0.1, unitValue: 10 };
const NQ: InstrumentSpec = { measureUnit: 'tick', unitSize: 0.25, unitValue: 5 };

describe('computeTradeMetrics', () => {
  it('counts pips for a winning XAUUSD short', () => {
    const m = computeTradeMetrics(XAUUSD, {
      direction: 'short',
      entryPrice: 4406.5,
      exitPrice: 4390,
      stopLoss: 4414,
      takeProfit: 4390,
      positionSize: 0.5,
      fxRate: 1,
    });
    expect(m.resultUnits).toBe(165);
    expect(m.pnlQuote).toBe(825);
    expect(m.pnlAccount).toBe(825);
    expect(m.riskUnits).toBe(75);
    expect(m.rMultiple).toBe(2.2);
    expect(m.plannedRR).toBe(2.2);
  });

  it('counts ticks for a losing NQ long and subtracts fees', () => {
    const m = computeTradeMetrics(NQ, {
      direction: 'long',
      entryPrice: 21000,
      exitPrice: 20990,
      stopLoss: 20990,
      positionSize: 2,
      fees: 4.5,
      fxRate: 1,
    });
    expect(m.resultUnits).toBe(-40);
    expect(m.pnlQuote).toBe(-400);
    expect(m.pnlAccount).toBe(-404.5);
    expect(m.rMultiple).toBe(-1);
  });

  it('converts to the account currency', () => {
    const m = computeTradeMetrics(XAUUSD, {
      direction: 'long',
      entryPrice: 4000,
      exitPrice: 4001,
      positionSize: 1,
      fxRate: 3.7,
    });
    expect(m.pnlQuote).toBe(100);
    expect(m.pnlAccount).toBe(370);
  });

  it('leaves results empty for an open trade or a missing FX rate', () => {
    const open = computeTradeMetrics(XAUUSD, { direction: 'long', entryPrice: 4000, positionSize: 1, stopLoss: 3990 });
    expect(open.resultUnits).toBeNull();
    expect(open.riskUnits).toBe(100);

    const noFx = computeTradeMetrics(XAUUSD, { direction: 'long', entryPrice: 4000, exitPrice: 4010, positionSize: 1 });
    expect(noFx.pnlQuote).toBe(1000);
    expect(noFx.pnlAccount).toBeNull();
  });
});

describe('parseSignal', () => {
  it('parses the educator format', () => {
    const result = parseSignal('XAUUSD - SELL\nIN: 4406.50\nSL: 4414\nTP1: 4390\nTP2:4384');
    expect(result).toEqual({
      ok: true,
      warnings: [],
      signal: { symbol: 'XAUUSD', direction: 'short', entryPrice: 4406.5, stopLoss: 4414, takeProfits: [4390, 4384] },
    });
  });

  it('accepts commas, lowercase and TP without a number', () => {
    const result = parseSignal('nq1 buy\nin 21000,25\nsl 20980\ntp 21050');
    expect(result.ok && result.signal).toEqual({
      symbol: 'NQ1',
      direction: 'long',
      entryPrice: 21000.25,
      stopLoss: 20980,
      takeProfits: [21050],
    });
  });

  it('warns about prices on the wrong side', () => {
    const result = parseSignal('XAUUSD - SELL\nIN: 4406\nSL: 4400\nTP1: 4420');
    expect(result.ok && result.warnings).toHaveLength(2);
  });

  it('reports missing fields', () => {
    const result = parseSignal('XAUUSD - SELL\nIN: 4406');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual(['Brak Stop Loss (SL)', 'Brak Take Profit (TP)']);
  });
});

describe('dates', () => {
  it('uses the local calendar day of the user time zone', () => {
    // 23:30 UTC on 25 Sep is already 26 Sep in Warsaw (UTC+2).
    expect(toLocalDate(new Date('2025-09-25T23:30:00Z'), 'Europe/Warsaw')).toBe('2025-09-26');
    expect(toLocalDate(new Date('2025-09-25T23:30:00Z'), 'America/New_York')).toBe('2025-09-25');
  });

  it('formats the daily label', () => {
    expect(formatDayLabel(1, '2025-09-26', 'long')).toBe('1/26.09.2025 – LONG');
  });
});

describe('detectDirection', () => {
  it('reads SELL from a stop above the entry and BUY from a stop below', () => {
    expect(detectDirection(4406.5, 4414, [4390])).toBe('short');
    expect(detectDirection(4371, 4360, [4395])).toBe('long');
  });
  it('falls back to the first take profit without a stop', () => {
    expect(detectDirection(4400, null, [4380, 4370])).toBe('short');
    expect(detectDirection(4400, undefined, [null, 4420])).toBe('long');
  });
  it('returns null when the levels do not tell', () => {
    expect(detectDirection(4400)).toBeNull();
    expect(detectDirection(4400, 4400, [4400])).toBeNull();
  });
});

describe('risk and margin', () => {
  it('prices the stop distance in money', () => {
    expect(riskQuote(XAUUSD, { entryPrice: 4406.5, stopLoss: 4414, positionSize: 0.5 })).toBe(375);
    expect(riskQuote(NQ, { entryPrice: 19842, stopLoss: 19822, positionSize: 2 })).toBe(800);
    expect(riskQuote(XAUUSD, { entryPrice: 4406.5, stopLoss: null, positionSize: 1 })).toBeNull();
  });
  it('computes the notional and the margin at a leverage', () => {
    expect(notionalQuote(XAUUSD, 4400, 1)).toBe(440_000);
    expect(marginQuote(XAUUSD, 4400, 0.1, 100)).toBe(440);
    expect(marginQuote({ measureUnit: 'point', unitSize: 1, unitValue: 1 }, 19842, 1, 20)).toBe(992.1);
  });
});

describe('exitReason', () => {
  const long = { direction: 'long' as const, stopLoss: 4390, takeProfit: 4420 };
  const short = { direction: 'short' as const, stopLoss: 4410, takeProfit: 4380 };

  it('reads TP and SL on both sides', () => {
    expect(exitReason({ ...long, exitPrice: 4420 })).toBe('tp');
    expect(exitReason({ ...long, exitPrice: 4385 })).toBe('sl');
    expect(exitReason({ ...short, exitPrice: 4375 })).toBe('tp');
    expect(exitReason({ ...short, exitPrice: 4410 })).toBe('sl');
  });

  it('marks a zero result as breakeven and leaves manual exits and open trades unmarked', () => {
    expect(exitReason({ ...long, exitPrice: 4400, resultUnits: 0 })).toBe('be');
    expect(exitReason({ ...long, exitPrice: 4405, resultUnits: 50 })).toBeNull();
    expect(exitReason({ ...long, exitPrice: null })).toBeNull();
  });
});

describe('tradeOutcome', () => {
  it('treats results within ±0.1R as breakeven', () => {
    expect(tradeOutcome({ resultUnits: -3, rMultiple: -0.03 })).toBe('breakeven');
    expect(tradeOutcome({ resultUnits: 10, rMultiple: 0.1 })).toBe('breakeven');
    expect(tradeOutcome({ resultUnits: 11, rMultiple: 0.11 })).toBe('win');
    expect(tradeOutcome({ resultUnits: -100, rMultiple: -1 })).toBe('loss');
  });

  it('needs exactly zero without a stop loss, and is null while open', () => {
    expect(tradeOutcome({ resultUnits: 0, rMultiple: null })).toBe('breakeven');
    expect(tradeOutcome({ resultUnits: 2, rMultiple: null })).toBe('win');
    expect(tradeOutcome({ resultUnits: null })).toBeNull();
  });
});
