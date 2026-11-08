import { monthOf } from '@/lib/price-index/months';
import type { IndexSeries } from '@/lib/price-index/series';

type Snapshot = {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
};

/** Restates each snapshot in the latest index month's prices. Newer-than-index snapshots are unchanged. */
export function adjustSnapshotsForInflation<T extends Snapshot>(
  snapshots: T[],
  series: IndexSeries
): (T & {
  adjustedNetWorth: number;
  adjustedTotalAssets: number;
  adjustedTotalLiabilities: number;
  inflationFactor: number;
})[] {
  return snapshots.map((s) => {
    const factor = series.factor(monthOf(new Date(s.date)));
    return {
      ...s,
      adjustedNetWorth: s.netWorth * factor,
      adjustedTotalAssets: s.totalAssets * factor,
      adjustedTotalLiabilities: s.totalLiabilities * factor,
      inflationFactor: factor,
    };
  });
}
