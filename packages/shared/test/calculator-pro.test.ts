import { describe, expect, it } from 'vitest';
import { fillOnCandle } from '../src/backtest.ts';
import { aggregateCandles, findCandleHits, readAtHit } from '../src/calculator-pro.ts';

const candle = (time: string, open: number, high: number, low: number, close: number) => ({ time, open, high, low, close });

describe('calculator PRO', () => {
  const cfd = [
    candle('2026-10-14T13:30:00.000Z', 100, 112, 98, 110),
    candle('2026-10-14T13:35:00.000Z', 110, 120, 109, 115),
    candle('2026-10-14T13:40:00.000Z', 115, 119.8, 111, 112),
  ];
  const futures = [
    candle('2026-10-14T13:30:00.000Z', 228, 240.25, 226, 238),
    candle('2026-10-14T13:35:00.000Z', 238, 248.5, 237, 243.25),
  ];

  it('finds the candles with a point at the level, exact ones first, then newest first', () => {
    // 120 is exactly the second candle's high; the third's 119.8 is only near it.
    expect(findCandleHits(cfd, 120, 0.5)).toEqual([
      { time: '2026-10-14T13:35:00.000Z', point: 'high', price: 120 },
      { time: '2026-10-14T13:40:00.000Z', point: 'high', price: 119.8 },
    ]);
    expect(findCandleHits(cfd, 119.9, 0.5).map((h) => h.time)).toEqual(['2026-10-14T13:40:00.000Z', '2026-10-14T13:35:00.000Z']);
    // The closest point of a candle counts: 110 is the first candle's close and the second's open.
    expect(findCandleHits(cfd, 110.2, 0.5).map((h) => h.point)).toEqual(['open', 'close']);
    expect(findCandleHits(cfd, 130, 2)).toEqual([]);
    expect(findCandleHits(cfd, 120, 0.5, 1)).toHaveLength(1);
  });

  it('reads the same point of the other market at the same time', () => {
    const [hit] = findCandleHits(cfd, 120, 0.1);
    expect(readAtHit(futures, hit!)).toBe(248.5);
    // The futures feed is late: its newest candle may be missing.
    const [late] = findCandleHits(cfd, 119.8, 0.1);
    expect(readAtHit(futures, late!)).toBeNull();
  });

  it('merges hours into four-hour candles from midnight UTC', () => {
    const hours = [
      candle('2026-10-14T03:00:00.000Z', 1, 2, 0.5, 1.5),
      candle('2026-10-14T04:00:00.000Z', 1.5, 3, 1, 2),
      candle('2026-10-14T05:00:00.000Z', 2, 4, 1.8, 3.5),
      candle('2026-10-14T05:52:59.000Z', 3.5, 3.6, 0.9, 3.2),
    ];
    expect(aggregateCandles(hours, 4 * 3_600_000)).toEqual([
      candle('2026-10-14T00:00:00.000Z', 1, 2, 0.5, 1.5),
      candle('2026-10-14T04:00:00.000Z', 1.5, 4, 0.9, 3.2),
    ]);
  });
});

describe('backtest fills', () => {
  const bar = (open: number, high: number, low: number, close: number) => ({ time: '2026-10-01T08:00:00.000Z', open, high, low, close });

  it('closes at the stop or the target, the stop first when a candle reaches both', () => {
    const long = { direction: 'long' as const, stopLoss: 90, takeProfit: 120 };
    expect(fillOnCandle(long, bar(100, 110, 95, 105))).toBeNull();
    expect(fillOnCandle(long, bar(100, 121, 95, 118))).toEqual({ price: 120, reason: 'tp' });
    expect(fillOnCandle(long, bar(100, 125, 85, 110))).toEqual({ price: 90, reason: 'sl' });
    const short = { direction: 'short' as const, stopLoss: 110, takeProfit: 80 };
    expect(fillOnCandle(short, bar(100, 105, 79, 82))).toEqual({ price: 80, reason: 'tp' });
    expect(fillOnCandle({ ...short, takeProfit: null }, bar(100, 111, 95, 104))).toEqual({ price: 110, reason: 'sl' });
  });

  it('fills a gap beyond a level at the open', () => {
    expect(fillOnCandle({ direction: 'long', stopLoss: 90, takeProfit: null }, bar(85, 88, 80, 86))).toEqual({ price: 85, reason: 'sl' });
    expect(fillOnCandle({ direction: 'short', stopLoss: null, takeProfit: 80 }, bar(75, 78, 70, 72))).toEqual({ price: 75, reason: 'tp' });
  });
});
