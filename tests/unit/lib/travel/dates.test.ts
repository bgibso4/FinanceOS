import { describe, it, expect } from 'vitest';
import { addDays, dayEnd, dayStart, tripDays, tripYear } from '@/lib/travel/dates';

const trip = (startDate: string, endDate: string) => ({ id: 't', name: 'T', startDate, endDate });

describe('travel dates', () => {
  it('tripDaysInclusive', () => {
    expect(tripDays(trip('2026-01-13', '2026-01-21'))).toBe(9);
    expect(tripDays(trip('2026-03-05', '2026-03-05'))).toBe(1);
    expect(tripDays(trip('2026-12-28', '2027-01-03'))).toBe(7);
  });

  it('tripYear is the start year', () => {
    expect(tripYear(trip('2026-12-28', '2027-01-03'))).toBe(2026);
  });

  it('dayEndIsLastMillisecond', () => {
    expect(dayStart('2026-01-13').toISOString()).toBe('2026-01-13T00:00:00.000Z');
    expect(dayEnd('2026-01-13').toISOString()).toBe('2026-01-13T23:59:59.999Z');
  });

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
