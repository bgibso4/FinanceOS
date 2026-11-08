import { describe, it, expect } from 'vitest';
import { utcDay, isoDay, addDays, lastAtOrBefore, zonedDay } from '@/lib/investments/dates';

describe('investment dates', () => {
  it('utcDay parses a YYYY-MM-DD string to UTC midnight', () => {
    expect(utcDay('2026-10-09').toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('utcDay truncates a Date to its UTC day', () => {
    expect(utcDay(new Date('2026-10-09T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-09T00:00:00.000Z'
    );
  });

  it('isoDay formats a Date as YYYY-MM-DD in UTC', () => {
    expect(isoDay(new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05');
  });

  it('addDays adds whole days', () => {
    expect(isoDay(addDays(utcDay('2026-03-01'), -1))).toBe('2026-02-28');
  });
});

describe('zonedDay', () => {
  it('is the calendar day on the zone clock, as UTC midnight', () => {
    expect(zonedDay(new Date('2026-07-09T23:00:00Z'), 'Europe/London').toISOString()).toBe(
      '2026-07-10T00:00:00.000Z'
    );
    expect(zonedDay(new Date('2026-07-10T02:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-07-09T00:00:00.000Z'
    );
  });
});

describe('lastAtOrBefore', () => {
  it('returns the last value at or before t', () => {
    expect(lastAtOrBefore([1, 3, 5], 4)).toBe(3);
    expect(lastAtOrBefore([1, 3, 5], 5)).toBe(5);
    expect(lastAtOrBefore([1, 3, 5], 0)).toBeUndefined();
  });
});
