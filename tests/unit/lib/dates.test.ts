import { describe, it, expect } from 'vitest';
import { fmtCalendarDay, fmtStoredDate, localDay, storedToday, utcMonthRange } from '@/lib/dates';
import { adjustSnapshotsForInflation } from '@/lib/inflation';
import { IndexSeries } from '@/lib/price-index/series';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { freezeClock, inNewYork, NEW_YORK_EVENING } from '../../helpers/time-zone';

describe('dates, in New York', () => {
  inNewYork();
  const evening = new Date(NEW_YORK_EVENING);

  it('localDay is the day on the wall clock, not the UTC day', () => {
    expect(localDay(evening)).toBe('2026-11-06');
  });

  it('storedToday is the local day at UTC midnight, as transactions are stored', () => {
    expect(storedToday(evening).toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('fmtCalendarDay shows a stored date as it is', () => {
    const opts = { month: 'short', day: 'numeric' } as const;
    expect(fmtCalendarDay('2026-11-01T00:00:00.000Z', opts)).toBe('Nov 1');
    expect(fmtCalendarDay('2026-11-01', opts)).toBe('Nov 1');
  });

  it('fmtCalendarDay names the right month for a YYYY-MM-01 label', () => {
    expect(fmtCalendarDay('2026-11-01', { month: 'long', year: 'numeric' })).toBe('November 2026');
  });

  it('fmtStoredDate shows a midnight date as stored and a real moment in local time', () => {
    const opts = { month: 'short', day: 'numeric' } as const;
    expect(fmtStoredDate('2026-10-01T00:00:00.000Z', opts)).toBe('Oct 1');
    expect(fmtStoredDate('2026-01-27T02:23:00.000Z', opts)).toBe('Jan 26');
  });

  it('utcMonthRange covers the month as stored, and rolls across years', () => {
    const { start, end } = utcMonthRange(2026, 10);
    expect(start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T23:59:59.999Z');
    expect(utcMonthRange(2026, -1).start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });

  it('the analyst is told the local date', () => {
    freezeClock(NEW_YORK_EVENING);
    expect(buildSystemPrompt([])).toContain("Today's date: 2026-11-06");
  });

  it('inflation counts a Jan 1 date in its own month', () => {
    const series = IndexSeries.of([
      { month: '2025-12', value: 100 },
      { month: '2026-01', value: 110 },
    ]);
    const [adjusted] = adjustSnapshotsForInflation(
      [
        {
          date: '2026-01-01T00:00:00.000Z',
          netWorth: 100,
          totalAssets: 100,
          totalLiabilities: 0,
        },
      ],
      series
    );
    expect(adjusted.inflationFactor).toBe(1);
  });
});
