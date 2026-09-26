import { describe, expect, it } from 'vitest';
import { convertLevel, findPairBySymbol, roundToStep } from '../src/index.ts';

describe('CFD ↔ futures conversion', () => {
  const basis = { cfdPrice: 24_000, futuresPrice: 24_120 };

  it('shifts levels by the point difference', () => {
    expect(convertLevel(23_950, basis, 'futures', 'offset')).toBe(24_070);
    expect(convertLevel(24_070, basis, 'cfd', 'offset')).toBe(23_950);
  });

  it('scales levels by the price ratio', () => {
    expect(convertLevel(24_000, basis, 'futures', 'ratio')).toBeCloseTo(24_120, 6);
    expect(convertLevel(23_000, basis, 'futures', 'ratio')).toBeCloseTo(23_115, 6);
    expect(convertLevel(23_115, basis, 'cfd', 'ratio')).toBeCloseTo(23_000, 6);
  });

  it('rounds to the tick size', () => {
    expect(roundToStep(24_070.13, 0.25)).toBe(24_070.25);
    expect(roundToStep(4_423.46, 0.1)).toBe(4_423.5);
    expect(roundToStep(46_120.6, 1)).toBe(46_121);
  });

  it('finds the pair from any symbol spelling', () => {
    expect(findPairBySymbol('NAS100')).toMatchObject({ pair: { key: 'nasdaq' }, side: 'cfd' });
    expect(findPairBySymbol('MNQ1!')).toMatchObject({ pair: { key: 'nasdaq' }, side: 'futures' });
    expect(findPairBySymbol('GOLD')).toMatchObject({ pair: { mini: 'GC1' }, side: 'cfd' });
    expect(findPairBySymbol('EURUSD')).toBeNull();
  });
});
