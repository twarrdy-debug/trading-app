import { describe, expect, it } from 'vitest';
import { analysisSource, atr, dayLevels, ema, findEqualLevels, findFvgs, findStructure, findSwings, macd, premiumDiscount, rsi, sessionLevels, withLivePrice, type Candle } from '../src/index.ts';

/** Hourly candles from [high, low] pairs; open/close sit in the middle. */
const candles = (bars: [number, number][], start = '2026-10-05T00:00:00Z', stepMs = 3_600_000): Candle[] =>
  bars.map(([high, low], i) => ({
    time: new Date(new Date(start).getTime() + i * stepMs).toISOString(),
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
  }));

describe('swings', () => {
  it('finds fractal highs and lows and whether price later went beyond them', () => {
    const c = candles([
      [10, 8],
      [12, 9],
      [15, 11], // swing high 15
      [13, 10],
      [11, 7], // swing low 7
      [12, 9],
      [16, 12], // takes out 15
      [14, 11],
      [13, 10],
    ]);
    const swings = findSwings(c, 2);
    expect(swings.map((s) => [s.kind, s.price, s.broken])).toEqual([
      ['high', 15, true],
      ['low', 7, false],
      ['high', 16, false],
    ]);
    expect(swings[0]!.brokenAt).toBe(c[6]!.time);
  });

  it('marks the first peak of a flat double top, not both', () => {
    const swings = findSwings(candles([[10, 8], [11, 9], [14, 12], [14, 11], [12, 10], [11, 9]]), 1);
    expect(swings.filter((s) => s.kind === 'high').map((s) => s.time)).toHaveLength(1);
  });
});

describe('equal highs and lows', () => {
  const c = candles([
    [100, 96],
    [104, 99], // swing high 104
    [101, 97],
    [99, 95],
    [101, 96],
    [104.2, 99], // swing high 104.2: equal to 104 within 0.5
    [102, 98],
    [100, 96],
    [103, 98],
    [105, 101], // sweeps the equal highs
    [102, 99],
    [101, 98],
  ]);

  it('groups swings within the tolerance and notes when the zone was swept', () => {
    const levels = findEqualLevels(c, findSwings(c, 1), 0.5);
    const highs = levels.find((l) => l.kind === 'highs')!;
    expect(highs.touches.map((t) => t.price)).toEqual([104, 104.2]);
    expect(highs.top).toBe(104.2);
    expect(highs.swept).toBe(true);
    expect(highs.sweptAt).toBe(c[9]!.time);
  });

  it('does not pair swings when price traded through the zone in between', () => {
    const through = candles([
      [100, 96],
      [104, 99],
      [101, 97],
      [106, 100], // above both: the first high was taken before the second formed
      [101, 96],
      [99, 95],
      [104.1, 99],
      [101, 98],
      [100, 97],
    ]);
    const levels = findEqualLevels(through, findSwings(through, 1), 0.5);
    expect(levels.filter((l) => l.kind === 'highs' && l.touches.some((t) => t.price === 104))).toHaveLength(0);
  });
});

describe('ATR and day levels', () => {
  it('averages the true range', () => {
    // True ranges: max(3, 12 − 9, 9 − 9) = 3, then max(1, |11 − 10.5|, |10 − 10.5|) = 1.
    expect(atr(candles([[10, 8], [12, 9], [11, 10]]), 2)).toBe(2);
    expect(atr(candles([[10, 8]]), 14)).toBeNull();
  });

  it('takes the previous weekday and the previous week from daily candles', () => {
    // Mon 5 Oct … Tue 13 Oct 2026, with the weekend of 10–11 Oct.
    const daily = candles(
      [
        [110, 100], // Mon 5
        [112, 101], // Tue
        [115, 104], // Wed
        [113, 103], // Thu
        [111, 99], // Fri 9: previous week's low 99, high 115
        [111, 110], // Sat
        [112, 109], // Sun
        [120, 108], // Mon 12: previous day
        [118, 114], // Tue 13: today
      ],
      '2026-10-05T00:00:00Z',
      86_400_000,
    );
    expect(dayLevels(daily)).toMatchObject({ pdh: 120, pdl: 108, pwh: 115, pwl: 99, todayOpen: 116 });
  });
});

describe('analysis source', () => {
  it('uses the instrument itself or, for futures, the paired CFD', () => {
    expect(analysisSource('XAUUSD')).toEqual({ epic: 'GOLD', via: null });
    expect(analysisSource('MNQ1')).toEqual({ epic: 'US100', via: 'US100' });
    expect(analysisSource('GC1')).toEqual({ epic: 'GOLD', via: 'XAUUSD' });
    expect(analysisSource('BTCUSD')).toEqual({ epic: 'BTCUSD', via: null });
    // CME bitcoin from the CFD's candles; an exchange perpetual from the coin's CFD.
    expect(analysisSource('MBT1')).toEqual({ epic: 'BTCUSD', via: 'BTCUSD' });
    expect(analysisSource('ETHUSDT')).toEqual({ epic: 'ETHUSD', via: null });
    expect(analysisSource('EURGBP')).toBeNull();
  });
});

describe('indicators', () => {
  it('starts the EMA with the simple average, then weights the newest close', () => {
    const e = ema([1, 2, 3, 4], 3);
    expect(e[1]).toBeNull();
    expect(e[2]).toBe(2);
    expect(e[3]).toBe(4 * 0.5 + 2 * 0.5);
  });

  it('gives RSI 100 with only gains and about 50 when gains and losses balance', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    const zigzag = Array.from({ length: 40 }, (_, i) => (i % 2 ? 11 : 10));
    expect(rsi(zigzag, 14).at(-1)).toBeGreaterThan(40);
    expect(rsi(zigzag, 14).at(-1)).toBeLessThan(60);
  });

  it('computes MACD as fast − slow EMA with a signal line', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(closes);
    expect(m.line[24]).toBeNull();
    expect(m.line[25]).toBeCloseTo(ema(closes, 12)[25]! - ema(closes, 26)[25]!, 9);
    expect(m.signal.findIndex((v) => v != null)).toBe(25 + 8);
    expect(m.histogram.at(-1)).toBeCloseTo(m.line.at(-1)! - m.signal.at(-1)!, 9);
  });
});

describe('smart money zones', () => {
  it('finds fair value gaps and marks them filled when price trades back through', () => {
    const c = candles([
      [101, 99],
      [106, 100], // impulse
      [108, 103], // low 103 > first high 101: bullish FVG 101–103
      [107, 104],
      [105, 100.5], // trades through 101: filled
    ]);
    const [gap] = findFvgs(c);
    expect(gap).toMatchObject({ kind: 'fvg', direction: 'bull', top: 103, bottom: 101, time: c[1]!.time });
    expect(gap!.endedAt).toBe(c[4]!.time);
  });

  it('reads BOS and CHoCH from swings and leaves an order block at the last opposite candle', () => {
    // Down leg, a swing low, then a rally that closes above the last swing high (a CHoCH after the down move).
    const bars: [number, number][] = [
      [110, 106], [112, 107], [111, 105], [108, 103], [106, 101], [104, 99], [102, 97], [103, 98], [105, 100], [107, 102], [113, 108], [115, 110],
    ];
    const c = candles(bars).map((x, i) => ({ ...x, open: i === 6 ? x.high - 0.5 : x.low + 0.5, close: i === 6 ? x.low + 0.5 : x.high - 0.5 }));
    const { breaks, orderBlocks } = findStructure(c, 1);
    expect(breaks.at(-1)).toMatchObject({ direction: 'bull', price: 112 });
    expect(orderBlocks.at(-1)).toMatchObject({ kind: 'ob', direction: 'bull', time: c[6]!.time });
  });

  it('splits the recent range into premium, equilibrium and discount', () => {
    const pd = premiumDiscount(candles([[110, 100], [120, 105], [115, 101]]))!;
    expect(pd).toMatchObject({ top: 120, bottom: 100, premium: { top: 120, bottom: 119 }, discount: { top: 101, bottom: 100 } });
    expect(pd.equilibrium.top).toBe(110.5);
  });

  it("takes session highs and lows in each city's hours", () => {
    // Hourly candles on Tuesday 13 Oct 2026 UTC: London 07:00–16:00 UTC (BST), New York 12:00–21:00 UTC.
    const day = candles(
      Array.from({ length: 24 }, (_, h) => [100 + h, 90 + h] as [number, number]),
      '2026-10-13T00:00:00Z',
    );
    const levels = sessionLevels(day, 1);
    const london = levels.find((l) => l.session === 'london')!;
    expect(london).toMatchObject({ high: 100 + 15, low: 90 + 7 });
    const tokyo = levels.find((l) => l.session === 'tokyo')!;
    // Tokyo 09:00–18:00 JST is 00:00–09:00 UTC.
    expect(tokyo).toMatchObject({ high: 100 + 8, low: 90 });
  });
});

describe('month and week opens', () => {
  it('adds the week and month open and the previous month range', () => {
    const daily = candles(
      Array.from({ length: 20 }, (_, i) => [200 + i, 190 + i] as [number, number]),
      '2026-09-24T00:00:00Z',
      86_400_000,
    );
    const levels = dayLevels(daily);
    expect(levels.pmh).toBe(200 + 6); // 24–30 Sept
    expect(levels.pml).toBe(190);
    expect(levels.monthOpen).toBe(daily.find((c) => c.time.startsWith('2026-10-01'))!.open);
    expect(levels.weekOpen).toBe(daily.find((c) => c.time.startsWith('2026-10-12'))!.open);
  });
});

describe('live price on the chart', () => {
  const c = (time: string, o: number, h: number, l: number, cl: number) => ({ time, open: o, high: h, low: l, close: cl });
  const candles = [c('2026-10-20T12:00:00.000Z', 10, 12, 9, 11), c('2026-10-20T12:05:00.000Z', 11, 13, 10, 12)];
  const M5 = 300_000;

  it('extends the last candle within its period', () => {
    expect(withLivePrice(candles, { time: '2026-10-20T12:07:30.000Z', price: 14 }, M5).at(-1)).toEqual(c('2026-10-20T12:05:00.000Z', 11, 14, 10, 14));
    expect(withLivePrice(candles, { time: '2026-10-20T12:07:30.000Z', price: 9.5 }, M5).at(-1)).toEqual(c('2026-10-20T12:05:00.000Z', 11, 13, 9.5, 9.5));
  });

  it('opens the next candle, and ignores a price older than the last candle', () => {
    const next = withLivePrice(candles, { time: '2026-10-20T12:10:02.000Z', price: 12.5 }, M5);
    expect(next).toHaveLength(3);
    expect(next.at(-1)).toEqual(c('2026-10-20T12:10:00.000Z', 12.5, 12.5, 12.5, 12.5));
    expect(withLivePrice(candles, { time: '2026-10-20T11:59:00.000Z', price: 50 }, M5)).toBe(candles);
    // Daily candles start at the source's own hour: only extended.
    expect(withLivePrice(candles, { time: '2026-10-21T12:10:00.000Z', price: 12.5 }, 86_400_000, true)).toHaveLength(2);
  });
});
