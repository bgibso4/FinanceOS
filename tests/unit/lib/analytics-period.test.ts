import { describe, expect, it } from 'vitest';
import {
  columnLabel,
  compareChartRange,
  compareRange,
  fullRange,
  isDaily,
  isLatest,
  periodLabel,
  periodRange,
  shiftMonths,
  stepPeriod,
  switchKind,
  type Period,
} from '@/lib/analytics-period';
import { inNewYork } from '../../helpers/time-zone';

const TODAY = '2026-11-07';
const nov: Period = { kind: 'month', anchor: '2026-11' };
const oct: Period = { kind: 'month', anchor: '2026-10' };
const q: Period = { kind: '3m', anchor: '2026-11' };
const yr: Period = { kind: 'year', anchor: '2026-12' };
const custom: Period = {
  kind: 'custom',
  anchor: '2026-10',
  custom: { start: '2026-06-01', end: '2026-10-31' },
};

describe('comparison ranges', () => {
  it('currentMonthComparesDayForDay', () => {
    expect(compareRange(nov, 'prev', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-07' });
    expect(compareRange(nov, 'lastYear', TODAY)).toEqual({
      start: '2025-11-01',
      end: '2025-11-07',
    });
  });
  it('finishedMonthComparesWhole', () => {
    expect(compareRange(oct, 'prev', TODAY)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(compareRange(oct, 'lastYear', TODAY)).toEqual({
      start: '2025-10-01',
      end: '2025-10-31',
    });
  });
  it('threeMonths', () => {
    expect(periodRange(q, TODAY)).toEqual({ start: '2026-09-01', end: TODAY, partial: true });
    expect(compareRange(q, 'prev', TODAY)).toEqual({ start: '2026-06-01', end: '2026-08-07' });
    expect(compareRange(q, 'lastYear', TODAY)).toEqual({ start: '2025-09-01', end: '2025-11-07' });
  });
  it('currentYear', () => {
    expect(compareRange(yr, 'prev', TODAY)).toEqual({ start: '2025-01-01', end: '2025-11-07' });
    expect(compareRange(yr, 'lastYear', TODAY)).toEqual({ start: '2025-01-01', end: '2025-11-07' });
  });
  it('customComparesSameLengthBefore', () => {
    expect(compareRange(custom, 'prev', TODAY)).toEqual({ start: '2025-12-30', end: '2026-05-31' });
    expect(compareRange(custom, 'lastYear', TODAY)).toEqual({
      start: '2025-06-01',
      end: '2025-10-31',
    });
  });
  it('clampsToShortMonth', () => {
    expect(compareRange({ kind: 'month', anchor: '2026-03' }, 'prev', '2026-03-30')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('noneIsNull', () => {
    expect(compareRange(nov, 'none', TODAY)).toBeNull();
    expect(compareChartRange(nov, 'none', TODAY)).toBeNull();
  });
  it('chartRangeRunsToMonthEnd', () => {
    expect(compareChartRange(nov, 'prev', TODAY)).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(compareChartRange(oct, 'prev', TODAY)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
  });
});

describe('stepping and switching', () => {
  it('steps each kind', () => {
    expect(stepPeriod(nov, -1, TODAY).anchor).toBe('2026-10');
    expect(stepPeriod(q, -1, TODAY).anchor).toBe('2026-08');
    expect(stepPeriod(yr, -1, TODAY).anchor).toBe('2025-12');
    expect(stepPeriod(oct, 1, TODAY).anchor).toBe('2026-11');
    const back = stepPeriod(custom, -1, TODAY).custom!;
    expect(back).toEqual({ start: '2025-12-30', end: '2026-05-31' });
  });
  it('custom steps forward to the same length ending today, never past it', () => {
    const mid: Period = {
      kind: 'custom',
      anchor: '2026-11',
      custom: { start: '2026-10-15', end: '2026-11-03' },
    };
    const next = stepPeriod(mid, 1, TODAY);
    expect(next.custom).toEqual({ start: '2026-10-19', end: TODAY });
    expect(next.anchor).toBe('2026-11');
    expect(isLatest(next, TODAY)).toBe(true);
    // A forward step that stays in the past is a plain step.
    const sep: Period = {
      kind: 'custom',
      anchor: '2026-09',
      custom: { start: '2026-09-01', end: '2026-09-10' },
    };
    expect(stepPeriod(sep, 1, TODAY).custom).toEqual({ start: '2026-09-11', end: '2026-09-20' });
  });
  it('isLatest only for the current period', () => {
    expect(isLatest(nov, TODAY)).toBe(true);
    expect(isLatest(oct, TODAY)).toBe(false);
    expect(isLatest(q, TODAY)).toBe(true);
    expect(isLatest(yr, TODAY)).toBe(true);
    expect(isLatest(custom, TODAY)).toBe(false);
  });
  it('switchKind', () => {
    expect(switchKind({ kind: 'year', anchor: '2025-12' }, 'month', TODAY).anchor).toBe('2025-12');
    expect(switchKind(yr, 'month', TODAY).anchor).toBe('2026-11');
    expect(switchKind({ kind: 'month', anchor: '2025-03' }, 'year', TODAY)).toEqual({
      kind: 'year',
      anchor: '2025-12',
    });
    expect(switchKind(nov, 'custom', TODAY).custom).toEqual({ start: '2026-11-01', end: TODAY });
  });
});

describe('labels', () => {
  it('periodLabel', () => {
    expect(periodLabel(nov)).toBe('November 2026');
    expect(periodLabel(q)).toBe('Sep – Nov 2026');
    expect(periodLabel({ kind: '3m', anchor: '2026-01' })).toBe('Nov 2025 – Jan 2026');
    expect(periodLabel(yr)).toBe('2026');
    expect(periodLabel(custom)).toBe('Jun 1 – Oct 31, 2026');
    const across: Period = {
      kind: 'custom',
      anchor: '2026-05',
      custom: { start: '2025-12-30', end: '2026-05-31' },
    };
    expect(periodLabel(across)).toBe('Dec 30, 2025 – May 31, 2026');
  });
  it('columnLabel', () => {
    expect(columnLabel(periodRange(nov, TODAY), nov)).toBe('Nov 2026 so far');
    expect(columnLabel({ start: '2026-10-01', end: '2026-10-07' }, nov)).toBe('Oct 1 – Oct 7');
    expect(columnLabel({ start: '2025-11-01', end: '2025-11-07' }, nov)).toBe(
      'Nov 1 – Nov 7, 2025'
    );
    expect(columnLabel({ start: '2026-09-01', end: '2026-09-30' }, oct)).toBe('Sep 2026');
    expect(columnLabel({ start: '2025-01-01', end: '2025-12-31' }, yr)).toBe('2025');
    expect(columnLabel(fullRange(custom), custom)).toBe('Jun 1 – Oct 31, 2026');
  });
  it('isDaily', () => {
    expect(isDaily(fullRange(oct))).toBe(true);
    expect(isDaily(fullRange(q))).toBe(false);
    expect(isDaily({ start: '2026-09-25', end: '2026-11-03' })).toBe(false);
  });
});

describe('in New York', () => {
  inNewYork();
  it('gives the same answers under a non-UTC zone', () => {
    expect(compareRange(nov, 'prev', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-07' });
    expect(periodLabel(custom)).toBe('Jun 1 – Oct 31, 2026');
    expect(stepPeriod(custom, -1, TODAY).custom).toEqual({
      start: '2025-12-30',
      end: '2026-05-31',
    });
  });
});
