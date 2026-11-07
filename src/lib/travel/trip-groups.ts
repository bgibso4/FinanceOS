/** Where a transaction falls against its trip: the UTC date part against the inclusive dates. */
const LABELS = ['Before', 'During', 'After'] as const;

type Dated = { date: string };

/** Rows (kept in their given order) under Before / During / After; empty groups are left out. */
export function groupByTripDates<T extends Dated>(
  trip: { startDate: string; endDate: string },
  rows: T[]
): { label: (typeof LABELS)[number]; rows: T[] }[] {
  const buckets: T[][] = [[], [], []];
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    buckets[day < trip.startDate ? 0 : day > trip.endDate ? 2 : 1].push(row);
  }
  return LABELS.map((label, i) => ({ label, rows: buckets[i] })).filter((g) => g.rows.length > 0);
}
