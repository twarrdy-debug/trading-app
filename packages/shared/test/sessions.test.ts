import { describe, expect, it } from 'vitest';
import { marketSessions } from '../src/index.ts';

const open = (iso: string) =>
  marketSessions(new Date(iso), 'Europe/Warsaw')
    .filter((s) => s.open)
    .map((s) => s.key);

describe('marketSessions', () => {
  it('knows which sessions are open, with daylight saving per city', () => {
    // Wednesday 30.09.2026, 14:30 in Warsaw (12:30 UTC): London and New York (08:30 there).
    expect(open('2026-09-30T12:30:00Z')).toEqual(['london', 'newyork']);
    // 02:00 UTC: Sydney (12:00) and Tokyo (11:00).
    expect(open('2026-09-30T02:00:00Z')).toEqual(['sydney', 'tokyo']);
    // In January London is on GMT: 08:00 UTC opens it, 07:30 UTC does not.
    expect(open('2027-01-13T07:30:00Z')).not.toContain('london');
    expect(open('2027-01-13T08:00:00Z')).toContain('london');
  });

  it('closes for the weekend and reopens with Sydney on Sunday evening', () => {
    expect(open('2026-10-03T12:00:00Z')).toEqual([]);
    const saturday = marketSessions(new Date('2026-10-03T12:00:00Z'), 'Europe/Warsaw');
    // Sydney opens Monday 07:00 local, which is Sunday 20:00 UTC (AEDT, UTC+11).
    expect(saturday.find((s) => s.key === 'sydney')!.current.start.toISOString()).toBe('2026-10-04T20:00:00.000Z');
    expect(saturday.every((s) => s.today.length === 0)).toBe(true);
  });

  it('lists the windows of the local day for the bar', () => {
    const ny = marketSessions(new Date('2026-09-30T12:30:00Z'), 'Europe/Warsaw').find((s) => s.key === 'newyork')!;
    expect(ny.today.map((w) => [w.start.toISOString(), w.end.toISOString()])).toEqual([['2026-09-30T12:00:00.000Z', '2026-09-30T21:00:00.000Z']]);
  });
});
