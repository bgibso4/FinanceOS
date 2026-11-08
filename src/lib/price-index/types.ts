export type IndexRegion = 'US' | 'CA';

export const INDEX_REGIONS: readonly IndexRegion[] = ['US', 'CA'];

export const REGION_NAMES: Record<IndexRegion, string> = { US: 'US', CA: 'Canada' };

/** A calendar month as `YYYY-MM`. Never time-zone converted; sorts as text. */
export type MonthKey = string;

export interface IndexObservation {
  month: MonthKey;
  value: number;
}

/** One agency's consumer price index, behind the vendor request. */
export interface PriceIndexSource {
  readonly region: IndexRegion;
  /** Shown under the 12-month table. */
  readonly attribution: string;
  /** Months the agency has not published (or published as non-numeric) are absent. */
  fetchMonths(from: MonthKey, to: MonthKey): Promise<IndexObservation[]>;
}

/** A source could not give a trustworthy answer (never an empty success). */
export class PriceIndexSourceError extends Error {}
