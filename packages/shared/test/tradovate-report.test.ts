import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTradovateReport, matchBrokerSymbol, parseCsv, parseTradovateNumber, parseTradovateReport, parseTradovateTime } from '../src/index.ts';

const csv = readFileSync(new URL('./fixtures/tradovate-position-history.csv', import.meta.url), 'utf8');

describe('Tradovate Position History', () => {
  it('recognises the export', () => {
    expect(isTradovateReport(csv)).toBe(true);
    expect(isTradovateReport('day_label;opened_at\n1;2')).toBe(false);
  });

  it('reads CSV cells and US dates', () => {
    expect(parseCsv('a,"b, c",""\r\n1,"say ""hi""",3\n')).toEqual([['a', 'b, c', ''], ['1', 'say "hi"', '3']]);
    expect(parseTradovateTime('10/2/2026 4:05:09')).toBe('2026-10-02T04:05:09');
  });

  it('rebuilds trades from paired fills: scale-ins, exits in parts and both directions', () => {
    const trades = parseTradovateReport(csv);
    expect(trades.map((t) => [t.direction, t.size, t.profit])).toEqual([
      ['long', 4, -84],
      ['short', 3, 408],
      ['short', 3, -54],
      ['short', 2, 26],
      ['long', 4, -249],
      ['long', 3, -213],
      ['long', 2, -145],
      ['long', 3, 612],
      ['short', 2, -78],
    ]);
    // Two entries of 2 averaged; one exit for all 4.
    expect(trades[0]).toMatchObject({
      account: 'DEMO0001',
      contract: 'MGCZ6',
      entryPrice: 4196.8,
      entries: 2,
      openTime: '2026-10-12T13:05:48',
      exits: [{ qty: 4, price: 4194.7, time: '2026-10-12T14:04:19' }],
      currency: 'USD',
    });
    // Two exits at the same second but different prices stay separate parts.
    expect(trades[6]!.exits).toEqual([
      { qty: 1, price: 4173.4, time: '2026-10-14T03:37:01' },
      { qty: 1, price: 4173.3, time: '2026-10-14T03:37:01' },
    ]);
    expect(trades[7]!.exits.map((e) => e.price)).toEqual([4182.5, 4186.6, 4189.2]);
    expect(matchBrokerSymbol('MGCZ6', [{ symbol: 'MGC1' }, { symbol: 'GC1' }])?.symbol).toBe('MGC1');
  });

  it('splits a fill that reverses the position', () => {
    const head = 'Buy Fill ID,Sell Fill ID,Paired Qty,Buy Price,Sell Price,P/L,Bought Timestamp,Sold Timestamp,Contract,Account';
    const text = [
      head,
      '1,2,1,100,101,10,10/01/2026 10:00:00,10/01/2026 10:05:00,NQZ6,A',
      '3,2,1,99,101,20,10/01/2026 10:10:00,10/01/2026 10:05:00,NQZ6,A',
    ].join('\n');
    // Sell 2 at 10:05 closes the long of 1 and opens a short of 1, bought back at 10:10.
    expect(parseTradovateReport(text).map((t) => [t.direction, t.size, t.entryPrice, t.profit])).toEqual([
      ['long', 1, 100, 10],
      ['short', 1, 101, 20],
    ]);
  });
});

describe('Tradovate Performance', () => {
  const performance = readFileSync(new URL('./fixtures/tradovate-performance.csv', import.meta.url), 'utf8');

  it('reads dollar amounts with losses in parentheses', () => {
    expect(parseTradovateNumber('$(68.00)')).toBe(-68);
    expect(parseTradovateNumber('$1,408.50')).toBe(1408.5);
    expect(parseTradovateNumber('-$12.00')).toBe(-12);
    expect(parseTradovateNumber('')).toBeNull();
  });

  it('is recognised and gives the same trades as Position History for the same fills', () => {
    expect(isTradovateReport(performance)).toBe(true);
    const fromPerformance = parseTradovateReport(performance);
    const fromHistory = parseTradovateReport(csv);
    // Same first fills, sizes, prices, exits and results; no account number, amounts in dollars.
    const shape = (t: (typeof fromHistory)[number]) => [t.id, t.direction, t.size, t.entryPrice, t.exits, t.profit];
    expect(fromPerformance.slice(0, fromHistory.length).map(shape)).toEqual(fromHistory.map(shape));
    expect(fromPerformance[0]).toMatchObject({ account: '', contract: 'MGCZ6', currency: 'USD' });
  });
});
