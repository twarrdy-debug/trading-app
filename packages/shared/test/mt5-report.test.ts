import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  brokerTimeToUtc,
  decodeReportText,
  matchBrokerSymbol,
  parseMt5Html,
  parseMt5Rows,
  parseReportDate,
  parseReportNumber,
  zonedTimeToUtc,
} from '../src/index.ts';

const html = readFileSync(new URL('./fixtures/mt5-report.html', import.meta.url), 'utf8');

describe('MT5 report', () => {
  it('reads the positions section and skips orders and deals', () => {
    const report = parseMt5Html(html);
    expect(report.account).toBe('12345678');
    expect(report.currency).toBe('USD');
    expect(report.positions.map((p) => p.position)).toEqual(['50001', '50002', '50003']);
    expect(report.positions[0]).toEqual({
      position: '50001',
      symbol: 'XAUUSD',
      direction: 'long',
      volume: 0.1,
      openTime: '2026-09-25T10:15:23',
      openPrice: 4371,
      stopLoss: 4360,
      takeProfit: 4395,
      closeTime: '2026-09-25T11:02:10',
      closePrice: 4390,
      commission: -0.7,
      swap: 0,
      profit: 190,
    });
    expect(report.positions[1]).toMatchObject({ direction: 'short', volume: 2, stopLoss: null, takeProfit: null, swap: -1.2, profit: -64 });
  });

  it('decodes the UTF-16 file MT5 writes', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]);
    expect(parseMt5Html(decodeReportText(new Uint8Array(utf16))).positions).toHaveLength(3);
  });

  it('accepts rows from a spreadsheet, including Polish terminal words', () => {
    const report = parseMt5Rows([
      ['Konto:', '', '87654321 (PLN, Broker, real)'],
      ['2026.09.25 10:15', '9', 'XAUUSDm', 'sprzedaż', '0,5', '4371,5', '', '', '2026.09.25 11:00', '4360', '0', '0', '575', ''],
    ]);
    expect(report).toMatchObject({ account: '87654321', currency: 'PLN' });
    expect(report.positions[0]).toMatchObject({ direction: 'short', volume: 0.5, openPrice: 4371.5, openTime: '2026-09-25T10:15:00' });
  });

  it('parses numbers and dates in report formats', () => {
    expect(parseReportNumber('1 234.56')).toBe(1234.56);
    expect(parseReportNumber('1,234.56')).toBe(1234.56);
    expect(parseReportNumber('-0,70')).toBe(-0.7);
    expect(parseReportNumber('')).toBeNull();
    expect(parseReportDate('2026.09.26 14:30')).toBe('2026-09-26T14:30:00');
    expect(parseReportDate('46291.5')).toBe('2026-09-26T12:00:00');
    expect(parseReportDate('filled')).toBeNull();
  });
});

describe('broker symbols', () => {
  const instruments = ['XAUUSD', 'US100', 'US500', 'US30', 'NQ1', 'MNQ1', 'GC1'].map((symbol) => ({ symbol }));
  it.each([
    ['XAUUSD', 'XAUUSD'],
    ['XAUUSDm', 'XAUUSD'],
    ['GOLD.pro', 'XAUUSD'],
    ['US100.cash', 'US100'],
    ['NAS100_i', 'US100'],
    ['USTEC', 'US100'],
    ['SPX500', 'US500'],
    ['DJ30.', 'US30'],
    ['NQZ26', 'NQ1'],
    ['MNQH7', 'MNQ1'],
  ])('%s → %s', (raw, symbol) => {
    expect(matchBrokerSymbol(raw, instruments)?.symbol).toBe(symbol);
  });
  it('leaves unknown symbols unmatched', () => {
    expect(matchBrokerSymbol('GER40', instruments)).toBeUndefined();
  });
});

describe('server time', () => {
  it('converts wall-clock time in a time zone', () => {
    expect(zonedTimeToUtc('2026-09-26T14:30:00', 'Europe/Warsaw').toISOString()).toBe('2026-09-26T12:30:00.000Z');
    expect(zonedTimeToUtc('2026-01-10T14:30:00', 'Europe/Warsaw').toISOString()).toBe('2026-01-10T13:30:00.000Z');
  });

  it('treats the usual broker zone as New York + 7 hours', () => {
    // Summer: GMT+3.
    expect(brokerTimeToUtc('2026-09-25T10:15:23', 'broker-ny7').toISOString()).toBe('2026-09-25T07:15:23.000Z');
    // Winter: GMT+2.
    expect(brokerTimeToUtc('2026-01-12T10:00:00', 'broker-ny7').toISOString()).toBe('2026-01-12T08:00:00.000Z');
    // US already on summer time, Europe not yet (2026-03-10): still GMT+3 for the broker.
    expect(brokerTimeToUtc('2026-03-10T10:00:00', 'broker-ny7').toISOString()).toBe('2026-03-10T07:00:00.000Z');
    expect(brokerTimeToUtc('2026-09-25T10:15:23', 'UTC').toISOString()).toBe('2026-09-25T10:15:23.000Z');
  });
});
