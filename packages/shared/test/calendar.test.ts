import { describe, expect, it } from 'vitest';
import { categorizeEvent } from '../src/index.ts';

describe('categorizeEvent', () => {
  it.each([
    ['Non-Farm Employment Change', 'labor'],
    ['Unemployment Rate', 'labor'],
    ['Unemployment Claims', 'labor'],
    ['Core CPI m/m', 'inflation'],
    ['Core PCE Price Index m/m', 'inflation'],
    ['Rightmove HPI m/m', 'housing'],
    ['Pending Home Sales m/m', 'housing'],
    ['Federal Funds Rate', 'central_bank'],
    ['FOMC Member Waller Speaks', 'central_bank'],
    ['BOJ Policy Rate', 'central_bank'],
    ['Final GDP q/q', 'growth'],
    ['Flash Manufacturing PMI', 'business'],
    ['ISM Services PMI', 'business'],
    ['Retail Sales m/m', 'consumer'],
    ['Trade Balance', 'trade'],
    ['10-y Bond Auction', 'bonds'],
    ['Bank Holiday', 'holiday'],
    ['Credit Card Spending y/y', 'consumer'],
    ['Consumer Confidence', 'consumer'],
    ['BOC Gov Macklem Speaks', 'central_bank'],
    ['German Buba President Nagel Speaks', 'central_bank'],
    ['President Trump Speaks', 'other'],
    ['Crude Oil Inventories', 'energy'],
    ['Natural Gas Storage', 'energy'],
    ['Something Unusual', 'other'],
  ])('%s → %s', (title, category) => {
    expect(categorizeEvent(title)).toBe(category);
  });
});
