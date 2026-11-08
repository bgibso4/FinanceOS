import { describe, it, expect } from 'vitest';
import { summarizePair } from '@/lib/fx/rate-summary';
import { addDays, utcDay } from '@/lib/investments/dates';

const row = (day: string, rate: number) => ({ date: utcDay(day), rate });

/** One row per day from `start`, rate = 1 + index/1000. */
const daily = (start: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    date: addDays(utcDay(start), i),
    rate: 1 + i / 1000,
  }));

describe('summarizePair', () => {
  it('summaryYearAgo takes the latest row at or before 365 days earlier', () => {
    const rows = [row('2025-11-07', 0.7), row('2025-11-09', 0.71), row('2026-11-08', 0.8)];
    const s = summarizePair(rows);
    expect(s).toMatchObject({ rate: 0.8, date: '2026-11-08', yearAgoRate: 0.7 });
  });

  it('summaryYearAgoNullWhenShortHistory', () => {
    const s = summarizePair([row('2026-06-01', 0.7), row('2026-11-08', 0.8)]);
    expect(s.yearAgoRate).toBeNull();
  });

  it('accepts rows in any order', () => {
    const s = summarizePair([row('2026-11-08', 0.8), row('2025-11-01', 0.6)]);
    expect(s.rate).toBe(0.8);
    expect(s.yearAgoRate).toBe(0.6);
  });

  it('summaryWeeklyPicksLastInBucket', () => {
    // Latest day 2026-11-08; the newest bucket is 11-02..11-08, the next 10-26..11-01.
    const rows = [
      row('2026-10-26', 1),
      row('2026-10-30', 2),
      row('2026-11-01', 3),
      row('2026-11-02', 4),
      row('2026-11-08', 5),
    ];
    expect(summarizePair(rows).weekly).toEqual([
      { day: '2026-11-01', rate: 3 },
      { day: '2026-11-08', rate: 5 },
    ]);
  });

  it('keeps at most 52 weekly points, oldest first', () => {
    const { weekly } = summarizePair(daily('2025-01-01', 600));
    expect(weekly).toHaveLength(52);
    expect(weekly[0].day < weekly[51].day).toBe(true);
  });

  it('summaryMonthEndsNewestFirst', () => {
    const rows = [
      row('2026-09-29', 1),
      row('2026-09-30', 2),
      row('2026-10-15', 3),
      row('2026-10-31', 4),
      row('2026-11-03', 5),
    ];
    expect(summarizePair(rows).monthEnds).toEqual([
      { month: '2026-11', rate: 5 },
      { month: '2026-10', rate: 4 },
      { month: '2026-09', rate: 2 },
    ]);
  });

  it('keeps at most 12 month ends', () => {
    expect(summarizePair(daily('2025-01-01', 600)).monthEnds).toHaveLength(12);
  });
});
