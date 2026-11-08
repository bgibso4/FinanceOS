import { describe, it, expect } from 'vitest';
import { adjustSnapshotsForInflation } from '@/lib/inflation';
import { IndexSeries } from '@/lib/price-index/series';

const series = IndexSeries.of([
  { month: '2025-09', value: 324.8 },
  { month: '2026-09', value: 336.94 },
]);

const snap = (date: string) => ({
  date,
  netWorth: 100,
  totalAssets: 150,
  totalLiabilities: 50,
});

describe('adjustSnapshotsForInflation', () => {
  it('adjustsByMonthlyIndex', () => {
    const [a] = adjustSnapshotsForInflation([snap('2025-09-15T00:00:00.000Z')], series);
    const factor = 336.94 / 324.8;
    expect(a.inflationFactor).toBeCloseTo(factor, 10);
    expect(a.adjustedNetWorth).toBeCloseTo(100 * factor, 8);
    expect(a.adjustedTotalAssets).toBeCloseTo(150 * factor, 8);
    expect(a.adjustedTotalLiabilities).toBeCloseTo(50 * factor, 8);
  });

  it('newerSnapshotUnadjusted', () => {
    const [a] = adjustSnapshotsForInflation([snap('2026-11-01T00:00:00.000Z')], series);
    expect(a.inflationFactor).toBe(1);
    expect(a.adjustedNetWorth).toBe(100);
  });

  it('keeps the snapshot fields', () => {
    const [a] = adjustSnapshotsForInflation(
      [{ ...snap('2025-09-15T00:00:00.000Z'), id: 'x' }],
      series
    );
    expect(a.id).toBe('x');
  });
});
