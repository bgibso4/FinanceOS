import { addMonths } from './months';
import type { IndexObservation, MonthKey } from './types';

export type IndexRow = {
  month: MonthKey;
  value: number;
  annual: number | null;
  monthly: number | null;
};

/** A region's monthly index values, answering changes and adjustment factors. */
export class IndexSeries {
  private constructor(private readonly obs: IndexObservation[]) {}

  /** Builds a series from observations in any order. */
  static of(obs: IndexObservation[]): IndexSeries {
    return new IndexSeries([...obs].sort((a, b) => a.month.localeCompare(b.month)));
  }

  latest(): IndexObservation | null {
    return this.obs[this.obs.length - 1] ?? null;
  }

  /** Percent change versus the same month a year earlier; null if either month is missing. */
  annualChange(m: MonthKey): number | null {
    return this.changeSince(m, addMonths(m, -12));
  }

  /** Percent change versus the previous month; null if either month is missing. */
  monthlyChange(m: MonthKey): number | null {
    return this.changeSince(m, addMonths(m, -1));
  }

  /** The last `n` stored months, newest first. */
  recent(n: number): IndexRow[] {
    return this.obs
      .slice(-n)
      .reverse()
      .map(({ month, value }) => ({
        month,
        value,
        annual: this.annualChange(month),
        monthly: this.monthlyChange(month),
      }));
  }

  /**
   * Multiplier that brings an amount from month `from` to today's prices: latest value over the
   * value at or before `from` (the earliest if none). 1 when `from` is not before the latest.
   */
  factor(from: MonthKey): number {
    const latest = this.latest();
    if (!latest || from >= latest.month) return 1;
    const base = [...this.obs].reverse().find((o) => o.month <= from) ?? this.obs[0];
    return latest.value / base.value;
  }

  private valueOf(m: MonthKey): number | null {
    return this.obs.find((o) => o.month === m)?.value ?? null;
  }

  private changeSince(m: MonthKey, base: MonthKey): number | null {
    const now = this.valueOf(m);
    const then = this.valueOf(base);
    return now === null || then === null ? null : (now / then - 1) * 100;
  }
}
