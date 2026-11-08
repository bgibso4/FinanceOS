import { describe, expect, it } from 'vitest';
import { IndexSeries } from '@/lib/price-index/series';

// Real US series; there is no 2025-10.
const series = IndexSeries.of([
  { month: '2026-09', value: 336.94 },
  { month: '2025-08', value: 323.976 },
  { month: '2025-09', value: 324.8 },
  { month: '2025-11', value: 324.122 },
  { month: '2025-12', value: 324.054 },
  { month: '2026-08', value: 334.98 },
]);

describe('IndexSeries', () => {
  it('latest returns the newest observation, null when empty', () => {
    expect(series.latest()).toEqual({ month: '2026-09', value: 336.94 });
    expect(IndexSeries.of([]).latest()).toBeNull();
  });

  it('computes annual and monthly change', () => {
    expect(series.annualChange('2026-09')).toBeCloseTo(3.738, 3);
    expect(series.monthlyChange('2026-09')).toBeCloseTo(0.585, 3);
  });

  it('missingMonthGivesNullChanges', () => {
    expect(series.monthlyChange('2025-11')).toBeNull();
    expect(series.annualChange('2026-10')).toBeNull();
  });

  it('recent returns the last n stored months, newest first', () => {
    const rows = series.recent(2);
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-08']);
    expect(rows[0].annual).toBeCloseTo(3.738, 3);
    expect(rows[0].value).toBe(336.94);
    expect(rows[0].monthly).toBeCloseTo(0.585, 3);
  });

  it('factorAfterLatestIsOne', () => {
    expect(series.factor('2026-09')).toBe(1);
    expect(series.factor('2026-11')).toBe(1);
  });

  it('factor is latest over the value in that month', () => {
    expect(series.factor('2025-09')).toBeCloseTo(336.94 / 324.8, 10);
  });

  it('factorForMissingMonthUsesEarlier', () => {
    expect(series.factor('2025-10')).toBeCloseTo(336.94 / 324.8, 10);
  });

  it('factor before the first month uses the earliest value', () => {
    expect(series.factor('2020-01')).toBeCloseTo(336.94 / 323.976, 10);
  });

  it('factor of an empty series is 1', () => {
    expect(IndexSeries.of([]).factor('2025-01')).toBe(1);
  });
});
