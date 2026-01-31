/**
 * Net worth forecasting with pluggable prediction strategies.
 *
 * Strategy pattern: implement ForecastStrategy, add to FORECAST_STRATEGIES.
 * The UI picks which strategy to run via getStrategy().
 */

export type ForecastDataPoint = {
  date: string;
  netWorth: number;
};

export type ForecastResult = {
  projections: Array<{
    monthsOut: number;
    date: string;
    projectedNetWorth: number;
  }>;
  metadata: {
    strategyName: string;
    description: string;
    inputDataPoints: number;
    confidence: 'low' | 'medium' | 'high';
    avgMonthlyChange?: number;
  };
};

/**
 * Strategy interface. All forecast algorithms implement this.
 * To add a new algorithm:
 *   1. Create a class implementing ForecastStrategy
 *   2. Add it to the FORECAST_STRATEGIES array
 */
export interface ForecastStrategy {
  name: string;
  description: string;
  forecast(historicalData: ForecastDataPoint[], horizonMonths: number[]): ForecastResult;
}

function monthsBetween(d1: Date, d2: Date): number {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) || 1;
}

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

/**
 * Linear projection based on average monthly net worth change.
 */
export class LinearSavingsRateStrategy implements ForecastStrategy {
  name = 'Linear (Avg Savings)';
  description = 'Projects net worth using average monthly net worth change';

  forecast(
    historicalData: ForecastDataPoint[],
    horizonMonths: number[] = [6, 12, 24]
  ): ForecastResult {
    if (historicalData.length < 2) {
      return {
        projections: horizonMonths.map((m) => ({
          monthsOut: m,
          date: addMonths(new Date(), m),
          projectedNetWorth: historicalData[0]?.netWorth ?? 0,
        })),
        metadata: {
          strategyName: this.name,
          description: this.description,
          inputDataPoints: historicalData.length,
          confidence: 'low',
          avgMonthlyChange: 0,
        },
      };
    }

    const sorted = [...historicalData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const months = monthsBetween(new Date(first.date), new Date(last.date));
    const totalChange = last.netWorth - first.netWorth;
    const avgMonthlyChange = totalChange / months;

    const latestNetWorth = last.netWorth;
    const now = new Date();
    const confidence = sorted.length >= 6 ? 'high' : sorted.length >= 3 ? 'medium' : 'low';

    return {
      projections: horizonMonths.map((m) => ({
        monthsOut: m,
        date: addMonths(now, m),
        projectedNetWorth: latestNetWorth + avgMonthlyChange * m,
      })),
      metadata: {
        strategyName: this.name,
        description: this.description,
        inputDataPoints: sorted.length,
        confidence,
        avgMonthlyChange,
      },
    };
  }
}

/**
 * Registry of available strategies.
 * Adding a new strategy: instantiate it and push to this array.
 */
export const FORECAST_STRATEGIES: ForecastStrategy[] = [new LinearSavingsRateStrategy()];

/**
 * Get strategy by name. Defaults to the first strategy.
 */
export function getStrategy(name?: string): ForecastStrategy {
  if (!name) return FORECAST_STRATEGIES[0];
  return FORECAST_STRATEGIES.find((s) => s.name === name) ?? FORECAST_STRATEGIES[0];
}
