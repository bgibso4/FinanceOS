import { describe, it, expect } from 'vitest';
import { LinearSavingsRateStrategy, FORECAST_STRATEGIES, getStrategy } from '@/lib/forecasting';
import type { ForecastDataPoint } from '@/lib/forecasting';

describe('forecasting', () => {
  describe('LinearSavingsRateStrategy', () => {
    const strategy = new LinearSavingsRateStrategy();

    it('projects based on average monthly change', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
        { date: '2024-07-01T00:00:00Z', netWorth: 106000 },
      ];

      const result = strategy.forecast(data, [6, 12]);

      // 6 months, $6000 change => $1000/month avg
      expect(result.metadata.avgMonthlyChange).toBeCloseTo(1000, 0);
      // 6 months out: 106000 + 1000*6 = 112000
      expect(result.projections[0].projectedNetWorth).toBeCloseTo(112000, 0);
      // 12 months out: 106000 + 1000*12 = 118000
      expect(result.projections[1].projectedNetWorth).toBeCloseTo(118000, 0);
    });

    it('returns flat projection with single data point', () => {
      const data: ForecastDataPoint[] = [{ date: '2024-06-01T00:00:00Z', netWorth: 50000 }];

      const result = strategy.forecast(data, [6, 12, 24]);

      expect(result.projections[0].projectedNetWorth).toBe(50000);
      expect(result.projections[1].projectedNetWorth).toBe(50000);
      expect(result.projections[2].projectedNetWorth).toBe(50000);
      expect(result.metadata.confidence).toBe('low');
      expect(result.metadata.avgMonthlyChange).toBe(0);
    });

    it('returns zero projection with no data points', () => {
      const result = strategy.forecast([], [6]);

      expect(result.projections[0].projectedNetWorth).toBe(0);
      expect(result.metadata.confidence).toBe('low');
    });

    it('handles constant net worth (zero change)', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
        { date: '2024-06-01T00:00:00Z', netWorth: 100000 },
      ];

      const result = strategy.forecast(data, [12]);

      expect(result.metadata.avgMonthlyChange).toBeCloseTo(0, 0);
      expect(result.projections[0].projectedNetWorth).toBeCloseTo(100000, 0);
    });

    it('handles negative trend (declining net worth)', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
        { date: '2024-07-01T00:00:00Z', netWorth: 94000 },
      ];

      const result = strategy.forecast(data, [6]);

      // -$6000 over 6 months = -$1000/month
      expect(result.metadata.avgMonthlyChange).toBeCloseTo(-1000, 0);
      // 6 months out: 94000 + (-1000)*6 = 88000
      expect(result.projections[0].projectedNetWorth).toBeCloseTo(88000, 0);
    });

    it('sets confidence based on data point count', () => {
      const makeData = (count: number): ForecastDataPoint[] =>
        Array.from({ length: count }, (_, i) => ({
          date: new Date(2024, i, 1).toISOString(),
          netWorth: 100000 + i * 1000,
        }));

      expect(strategy.forecast(makeData(2), [6]).metadata.confidence).toBe('low');
      expect(strategy.forecast(makeData(3), [6]).metadata.confidence).toBe('medium');
      expect(strategy.forecast(makeData(5), [6]).metadata.confidence).toBe('medium');
      expect(strategy.forecast(makeData(6), [6]).metadata.confidence).toBe('high');
      expect(strategy.forecast(makeData(12), [6]).metadata.confidence).toBe('high');
    });

    it('sorts unsorted input data chronologically', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-06-01T00:00:00Z', netWorth: 106000 },
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
      ];

      const result = strategy.forecast(data, [6]);

      // Should still calculate $1000/month avg despite reversed input
      expect(result.metadata.avgMonthlyChange).toBeCloseTo(1200, 0);
    });

    it('returns valid ISO dates for projections', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
        { date: '2024-06-01T00:00:00Z', netWorth: 106000 },
      ];

      const result = strategy.forecast(data, [6, 12]);

      result.projections.forEach((p) => {
        expect(() => new Date(p.date)).not.toThrow();
        expect(new Date(p.date).toISOString()).toBe(p.date);
      });
    });

    it('includes correct metadata', () => {
      const data: ForecastDataPoint[] = [
        { date: '2024-01-01T00:00:00Z', netWorth: 100000 },
        { date: '2024-06-01T00:00:00Z', netWorth: 106000 },
      ];

      const result = strategy.forecast(data, [6]);

      expect(result.metadata.strategyName).toBe('Linear (Avg Savings)');
      expect(result.metadata.description).toBeTruthy();
      expect(result.metadata.inputDataPoints).toBe(2);
    });
  });

  describe('FORECAST_STRATEGIES registry', () => {
    it('contains at least one strategy', () => {
      expect(FORECAST_STRATEGIES.length).toBeGreaterThanOrEqual(1);
    });

    it('contains LinearSavingsRateStrategy', () => {
      const names = FORECAST_STRATEGIES.map((s) => s.name);
      expect(names).toContain('Linear (Avg Savings)');
    });
  });

  describe('getStrategy', () => {
    it('returns first strategy when no name given', () => {
      const strategy = getStrategy();
      expect(strategy.name).toBe(FORECAST_STRATEGIES[0].name);
    });

    it('finds strategy by name', () => {
      const strategy = getStrategy('Linear (Avg Savings)');
      expect(strategy.name).toBe('Linear (Avg Savings)');
    });

    it('falls back to first strategy for unknown name', () => {
      const strategy = getStrategy('NonExistent Strategy');
      expect(strategy.name).toBe(FORECAST_STRATEGIES[0].name);
    });
  });
});
