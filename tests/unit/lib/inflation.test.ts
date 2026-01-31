import { describe, it, expect } from 'vitest';
import {
  parseInflationRates,
  getCumulativeInflationFactor,
  adjustForInflation,
  adjustSnapshotsForInflation,
} from '@/lib/inflation';

describe('inflation', () => {
  describe('parseInflationRates', () => {
    it('converts array of rate entries to map', () => {
      const entries = [
        { year: 2022, rate: 6.5 },
        { year: 2023, rate: 3.4 },
      ];

      const rateMap = parseInflationRates(entries);

      expect(rateMap.get(2022)).toBe(6.5);
      expect(rateMap.get(2023)).toBe(3.4);
    });

    it('handles empty array', () => {
      const rateMap = parseInflationRates([]);
      expect(rateMap.size).toBe(0);
    });

    it('overwrites duplicate years with last entry', () => {
      const entries = [
        { year: 2023, rate: 3.0 },
        { year: 2023, rate: 3.4 },
      ];

      const rateMap = parseInflationRates(entries);
      expect(rateMap.get(2023)).toBe(3.4);
    });
  });

  describe('getCumulativeInflationFactor', () => {
    const rates = new Map<number, number>([
      [2022, 6.5],
      [2023, 3.4],
      [2024, 2.9],
    ]);

    it('returns 1 when fromYear equals toYear', () => {
      expect(getCumulativeInflationFactor(2023, 2023, rates)).toBe(1);
    });

    it('returns 1 when fromYear is greater than toYear', () => {
      expect(getCumulativeInflationFactor(2025, 2023, rates)).toBe(1);
    });

    it('calculates single year factor', () => {
      // 2023 rate is 3.4% => factor = 1.034
      expect(getCumulativeInflationFactor(2023, 2024, rates)).toBeCloseTo(1.034, 4);
    });

    it('compounds multi-year factors', () => {
      // 2022: 6.5%, 2023: 3.4%, 2024: 2.9%
      // factor = 1.065 * 1.034 * 1.029 ≈ 1.1332
      const factor = getCumulativeInflationFactor(2022, 2025, rates);
      expect(factor).toBeCloseTo(1.065 * 1.034 * 1.029, 4);
    });

    it('treats missing years as 0% inflation', () => {
      // 2021 is missing, so factor for 2021 is 1.0, then 2022 is 1.065
      const factor = getCumulativeInflationFactor(2021, 2023, rates);
      expect(factor).toBeCloseTo(1.0 * 1.065, 4);
    });

    it('handles empty rates map', () => {
      const emptyRates = new Map<number, number>();
      expect(getCumulativeInflationFactor(2020, 2025, emptyRates)).toBe(1);
    });

    it('handles negative inflation rates (deflation)', () => {
      const deflationRates = new Map<number, number>([[2023, -2.0]]);
      const factor = getCumulativeInflationFactor(2023, 2024, deflationRates);
      expect(factor).toBeCloseTo(0.98, 4);
    });
  });

  describe('adjustForInflation', () => {
    const rates = new Map<number, number>([
      [2022, 6.5],
      [2023, 3.4],
    ]);

    it('adjusts positive values upward', () => {
      const adjusted = adjustForInflation(100000, 2022, 2024, rates);
      // 100000 * 1.065 * 1.034 = 110,121
      expect(adjusted).toBeCloseTo(100000 * 1.065 * 1.034, 0);
    });

    it('adjusts negative values (liabilities)', () => {
      const adjusted = adjustForInflation(-50000, 2022, 2024, rates);
      expect(adjusted).toBeCloseTo(-50000 * 1.065 * 1.034, 0);
    });

    it('returns same value when fromYear equals toYear', () => {
      expect(adjustForInflation(100000, 2023, 2023, rates)).toBe(100000);
    });

    it('returns same value with zero inflation', () => {
      const zeroRates = new Map<number, number>([[2023, 0]]);
      expect(adjustForInflation(100000, 2023, 2024, zeroRates)).toBe(100000);
    });
  });

  describe('adjustSnapshotsForInflation', () => {
    const rates = new Map<number, number>([
      [2022, 6.5],
      [2023, 3.4],
    ]);

    it('batch adjusts snapshots to target year', () => {
      const snapshots = [
        {
          date: '2022-12-31T00:00:00Z',
          netWorth: 100000,
          totalAssets: 150000,
          totalLiabilities: 50000,
        },
        {
          date: '2023-12-31T00:00:00Z',
          netWorth: 120000,
          totalAssets: 170000,
          totalLiabilities: 50000,
        },
      ];

      const adjusted = adjustSnapshotsForInflation(snapshots, 2024, rates);

      expect(adjusted).toHaveLength(2);

      // 2022 snapshot: factor = 1.065 * 1.034
      const factor2022 = 1.065 * 1.034;
      expect(adjusted[0].adjustedNetWorth).toBeCloseTo(100000 * factor2022, 0);
      expect(adjusted[0].adjustedTotalAssets).toBeCloseTo(150000 * factor2022, 0);
      expect(adjusted[0].adjustedTotalLiabilities).toBeCloseTo(50000 * factor2022, 0);
      expect(adjusted[0].inflationFactor).toBeCloseTo(factor2022, 4);

      // 2023 snapshot: factor = 1.034
      expect(adjusted[1].adjustedNetWorth).toBeCloseTo(120000 * 1.034, 0);
      expect(adjusted[1].inflationFactor).toBeCloseTo(1.034, 4);
    });

    it('preserves original values in output', () => {
      const snapshots = [
        {
          date: '2023-06-15T00:00:00Z',
          netWorth: 100000,
          totalAssets: 150000,
          totalLiabilities: 50000,
        },
      ];

      const adjusted = adjustSnapshotsForInflation(snapshots, 2024, rates);

      expect(adjusted[0].netWorth).toBe(100000);
      expect(adjusted[0].totalAssets).toBe(150000);
      expect(adjusted[0].totalLiabilities).toBe(50000);
      expect(adjusted[0].date).toBe('2023-06-15T00:00:00Z');
    });

    it('handles empty snapshots array', () => {
      const adjusted = adjustSnapshotsForInflation([], 2024, rates);
      expect(adjusted).toHaveLength(0);
    });

    it('returns factor of 1 for current year snapshots', () => {
      const snapshots = [
        {
          date: '2024-06-15T00:00:00Z',
          netWorth: 100000,
          totalAssets: 150000,
          totalLiabilities: 50000,
        },
      ];

      const adjusted = adjustSnapshotsForInflation(snapshots, 2024, rates);
      expect(adjusted[0].inflationFactor).toBe(1);
      expect(adjusted[0].adjustedNetWorth).toBe(100000);
    });
  });
});
