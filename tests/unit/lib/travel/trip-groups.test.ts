import { describe, it, expect } from 'vitest';
import { groupByTripDates } from '@/lib/travel/trip-groups';

const trip = { startDate: '2026-01-13', endDate: '2026-01-21' };
const row = (id: string, date: string) => ({ id, date });

describe('groupByTripDates', () => {
  it('splitsBeforeDuringAfterWithInclusiveEnds', () => {
    const groups = groupByTripDates(trip, [
      row('a', '2026-01-12T23:59:59.000Z'),
      row('b', '2026-01-13T00:00:00.000Z'),
      row('c', '2026-01-21T23:59:59.000Z'),
      row('d', '2026-01-22T00:00:00.000Z'),
    ]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Before', ['a']],
      ['During', ['b', 'c']],
      ['After', ['d']],
    ]);
  });

  it('omitsEmptyGroupsAndKeepsRowOrder', () => {
    const groups = groupByTripDates(trip, [
      row('x', '2026-01-18T00:00:00.000Z'),
      row('y', '2026-01-15T00:00:00.000Z'),
    ]);
    expect(groups).toEqual([
      {
        label: 'During',
        rows: [row('x', '2026-01-18T00:00:00.000Z'), row('y', '2026-01-15T00:00:00.000Z')],
      },
    ]);
  });

  it('returnsNothingForNoRows', () => {
    expect(groupByTripDates(trip, [])).toEqual([]);
  });
});
