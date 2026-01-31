/**
 * Inflation adjustment utilities.
 *
 * Architecture: InflationRateProvider interface allows swapping
 * the data source from manual DB rates to an external API later.
 */

export type InflationRateEntry = {
  year: number;
  rate: number; // Annual percentage, e.g. 3.4 for 3.4%
};

/**
 * Provider interface for inflation rate data.
 * Current: rates loaded from DB via parseInflationRates().
 * Future: implement ApiInflationProvider to fetch from CPI/BLS API.
 */
export interface InflationRateProvider {
  getRates(): Promise<Map<number, number>>;
}

/**
 * Parse inflation rates from DB array into a Map<year, rate>.
 * Mirrors parseExchangeRates() in currency.ts.
 */
export function parseInflationRates(rates: InflationRateEntry[]): Map<number, number> {
  const rateMap = new Map<number, number>();
  rates.forEach((r) => {
    rateMap.set(r.year, r.rate);
  });
  return rateMap;
}

/**
 * Get the cumulative inflation factor from a past year to a target year.
 *
 * Example: fromYear=2022, toYear=2025, rates: {2022: 6.5, 2023: 3.4, 2024: 2.9}
 * factor = (1 + 0.065) * (1 + 0.034) * (1 + 0.029) ≈ 1.1332
 *
 * Missing years default to 0% (factor 1.0).
 */
export function getCumulativeInflationFactor(
  fromYear: number,
  toYear: number,
  rates: Map<number, number>
): number {
  if (fromYear >= toYear) return 1;

  let factor = 1;
  for (let year = fromYear; year < toYear; year++) {
    const annualRate = rates.get(year) ?? 0;
    factor *= 1 + annualRate / 100;
  }
  return factor;
}

/**
 * Adjust a nominal amount from its snapshot year to target-year dollars.
 */
export function adjustForInflation(
  nominalValue: number,
  fromYear: number,
  toYear: number,
  rates: Map<number, number>
): number {
  const factor = getCumulativeInflationFactor(fromYear, toYear, rates);
  return nominalValue * factor;
}

/**
 * Batch-adjust an array of snapshots, returning inflation-adjusted values.
 * The toYear is typically the current year (most recent data).
 */
export function adjustSnapshotsForInflation(
  snapshots: Array<{
    date: string;
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
  }>,
  toYear: number,
  rates: Map<number, number>
): Array<{
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  adjustedNetWorth: number;
  adjustedTotalAssets: number;
  adjustedTotalLiabilities: number;
  inflationFactor: number;
}> {
  return snapshots.map((s) => {
    const fromYear = new Date(s.date).getFullYear();
    const factor = getCumulativeInflationFactor(fromYear, toYear, rates);
    return {
      ...s,
      adjustedNetWorth: s.netWorth * factor,
      adjustedTotalAssets: s.totalAssets * factor,
      adjustedTotalLiabilities: s.totalLiabilities * factor,
      inflationFactor: factor,
    };
  });
}
