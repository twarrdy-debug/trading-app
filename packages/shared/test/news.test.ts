import { describe, expect, it } from 'vitest';
import { eventTitleScore, matchKeywords, newsAffectsInstrument, parseNewsTitle, releaseSurprise, sameReleaseValue } from '../src/index.ts';

describe('parseNewsTitle', () => {
  it('reads economic releases', () => {
    const n = parseNewsTitle('FinancialJuice: UK Mortgage Lending Actual 4.410B (Forecast 4.4B, Previous 4.292B ,Revision 4.082B)');
    expect(n).toMatchObject({
      title: 'UK Mortgage Lending Actual 4.410B (Forecast 4.4B, Previous 4.292B ,Revision 4.082B)',
      category: 'data',
      currencies: ['GBP'],
      data: { name: 'UK Mortgage Lending', actual: '4.410B', forecast: '4.4B', previous: '4.292B', revision: '4.082B' },
      noise: false,
    });
    expect(parseNewsTitle('FinancialJuice: Italian PPI YoY Actual 10.9% (Forecast -, Previous 7.8%)').data).toEqual({
      name: 'Italian PPI YoY',
      actual: '10.9%',
      forecast: null,
      previous: '7.8%',
      revision: null,
    });
    expect(parseNewsTitle('FinancialJuice: RBA Cash Rate Actual 4.6% (Forecast 4.6%, Previous 4.35%)').currencies).toEqual(['AUD']);
  });

  it('finds speakers, outlets, currencies and categories', () => {
    expect(parseNewsTitle("FinancialJuice: ECB's Kazimir: Rate hike was unavoidable.")).toMatchObject({
      speaker: "ECB's Kazimir",
      category: 'central_bank',
      currencies: ['EUR'],
    });
    expect(parseNewsTitle('FinancialJuice: UK PM expected to signal plans for electoral reform - Guardian')).toMatchObject({
      title: 'UK PM expected to signal plans for electoral reform',
      sourceName: 'Guardian',
      category: 'politics',
      currencies: ['GBP'],
    });
    expect(
      parseNewsTitle("FinancialJuice: Iran's IRGC Spokesperson: US has no other choice but to declare failure and leave the region."),
    ).toMatchObject({ category: 'geopolitics', currencies: ['USD'] });
    expect(parseNewsTitle('FinancialJuice: NVIDIA and AMD up White House lobbying on China exports - Politico')).toMatchObject({
      assets: ['index'],
      currencies: ['USD', 'CNY'],
      sourceName: 'Politico',
    });
    expect(parseNewsTitle('FinancialJuice: Gold hits a fresh record high').assets).toEqual(['metal']);
  });

  it('marks posts that are empty without the paid terminal', () => {
    for (const title of ['MUFG: The JPY - FJElite', 'Fed Interest Rate Probabilities', '30-Day Correlation Matrix', 'FX Implied Volatility']) {
      expect(parseNewsTitle(`FinancialJuice: ${title}`).noise).toBe(true);
    }
    expect(parseNewsTitle('FinancialJuice: MUFG: The JPY - FJElite').sourceName).toBeNull();
  });
});

describe('releases', () => {
  it('compares the actual with the forecast from the currency point of view', () => {
    expect(releaseSurprise({ name: 'Spanish CPI YoY Flash', actual: '4.9%', forecast: '4.6%', previous: '4.3%', revision: null })).toBe('better');
    expect(releaseSurprise({ name: 'UK Mortgage Approvals', actual: '54.918k', forecast: '56.1k', previous: null, revision: null })).toBe('worse');
    expect(releaseSurprise({ name: 'US Initial Jobless Claims', actual: '250k', forecast: '230k', previous: null, revision: null })).toBe('worse');
    expect(releaseSurprise({ name: 'Spanish HICP MoM Flash', actual: '0.6%', forecast: '0.6%', previous: null, revision: null })).toBe('inline');
    expect(releaseSurprise({ name: 'Italian PPI YoY', actual: '10.9%', forecast: null, previous: '7.8%', revision: null })).toBe('better');
  });

  it('matches release names to calendar titles', () => {
    expect(eventTitleScore('Spanish CPI YoY Flash', 'Spanish Flash CPI y/y')).toBe(1);
    expect(eventTitleScore('Spanish CPI MoM Flash', 'Spanish Flash CPI y/y')).toBe(0);
    expect(eventTitleScore('RBA Cash Rate', 'Cash Rate')).toBeGreaterThan(0.9);
    expect(eventTitleScore('Swiss KOF Indicator', 'KOF Economic Barometer')).toBeGreaterThan(0.9);
    expect(eventTitleScore('US CPI MoM', 'CPI m/m')).toBeGreaterThan(eventTitleScore('US CPI MoM', 'Core CPI m/m'));
    expect(eventTitleScore('UK Mortgage Lending', 'Mortgage Approvals')).toBeLessThan(0.6);
    expect(sameReleaseValue('4.60%', '4.6%')).toBe(true);
    expect(sameReleaseValue('106', '106.0')).toBe(true);
    expect(sameReleaseValue('56.1k', '56K')).toBe(false);
  });
});

describe('matchKeywords', () => {
  it('finds whole-word starts, ignoring case', () => {
    expect(matchKeywords("Fed's Powell: Tariffs are inflationary", ['powell', 'tariff', 'gold', 'Fed'])).toEqual(['powell', 'tariff', 'Fed']);
    expect(matchKeywords('Golden week holidays in China', ['gold'])).toEqual(['gold']);
    expect(matchKeywords('Marigold sales', ['gold'])).toEqual([]);
  });
});

describe('newsAffectsInstrument', () => {
  const gold = { currencies: ['USD'], assetClass: 'metal' as const };
  const nasdaq = { currencies: ['USD'], assetClass: 'index' as const };
  const eurusd = { currencies: ['EUR', 'USD'], assetClass: 'forex' as const };
  const news = (title: string) => parseNewsTitle(`FinancialJuice: ${title}`);

  it('matches currencies, markets and, for gold, geopolitics', () => {
    expect(newsAffectsInstrument(news("Fed's Williams: one further hike is likely this year."), gold)).toBe(true);
    expect(newsAffectsInstrument(news('RBA Cash Rate Actual 4.6% (Forecast 4.6%, Previous 4.35%)'), gold)).toBe(false);
    expect(newsAffectsInstrument(news('Gold hits a fresh record high'), gold)).toBe(true);
    expect(newsAffectsInstrument(news('Israel strikes targets near Tehran'), gold)).toBe(true);
    expect(newsAffectsInstrument(news('Israel strikes targets near Tehran'), nasdaq)).toBe(false);
    expect(newsAffectsInstrument(news('Nvidia turns to insurers to share risk of AI expansion'), nasdaq)).toBe(true);
    expect(newsAffectsInstrument(news('Gold hits a fresh record high'), eurusd)).toBe(false);
    expect(newsAffectsInstrument(news("ECB's Kazimir: Rate hike was unavoidable."), eurusd)).toBe(true);
  });
});
