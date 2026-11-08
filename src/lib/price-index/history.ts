import { systemClock, type Clock } from '@/lib/clock';
import { addMonths, monthOf } from './months';
import type { PriceIndexStore } from './store';
import type { IndexRegion, MonthKey, PriceIndexSource } from './types';

/** Months before the last stored one that are read again, because agencies revise them. */
export const REVISION_MONTHS = 3;
/** A month's index may move at most this far from the previous observation. */
export const MAX_MONTHLY_MOVE = 0.05;
/** First fills reach this far back before the earlier of the first snapshot and a year ago. */
const LEAD_MONTHS = 12;

export type IndexFillResult = { regions: IndexRegion[]; months: number; failed: IndexRegion[] };

/**
 * Keeps each region's monthly consumer price index current. A region whose newest stored month
 * is last month or later is skipped (nothing newer can exist) unless the stored range starts later than snapshots need,
 * in which case it is fetched again from the needed start; otherwise recent months are re-read
 * for revisions. An answer that is unusable writes nothing for that region.
 */
export class PriceIndexHistory {
  constructor(
    private readonly store: PriceIndexStore,
    private readonly sources: PriceIndexSource[],
    private readonly firstNeededMonth: () => Promise<MonthKey | null>,
    private readonly clock: Clock = systemClock
  ) {}

  async fill(): Promise<IndexFillResult> {
    const thisMonth = monthOf(this.clock.now());
    const result: IndexFillResult = { regions: [], months: 0, failed: [] };
    for (const source of this.sources) {
      result.regions.push(source.region);
      try {
        result.months += await this.fillRegion(source, thisMonth);
      } catch (error) {
        console.warn(
          `[price-index] ${source.region} not updated: ${error instanceof Error ? error.message : error}`
        );
        result.failed.push(source.region);
      }
    }
    return result;
  }

  /** Fetches and stores one region; throws, storing nothing, if the answer is unusable. */
  private async fillRegion(source: PriceIndexSource, thisMonth: MonthKey): Promise<number> {
    const last = await this.store.lastMonth(source.region);
    const first = await this.store.firstMonth(source.region);
    const neededStart = addMonths(await this.startAnchor(thisMonth), -LEAD_MONTHS);
    // Snapshots older than the stored range would otherwise be under-adjusted.
    const coversNeed = first !== null && first <= neededStart;
    if (last !== null && last >= addMonths(thisMonth, -1) && coversNeed) return 0;

    const from = coversNeed && last !== null ? addMonths(last, -REVISION_MONTHS) : neededStart;
    const answer = [...(await source.fetchMonths(from, thisMonth))].sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    let previous = await this.storedBefore(source.region, answer[0]?.month);
    for (const { month, value } of answer) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`unusable index ${value} for ${month}`);
      }
      if (previous !== undefined && Math.abs(value / previous - 1) > MAX_MONTHLY_MOVE) {
        throw new Error(`index ${value} for ${month} is too far from ${previous}`);
      }
      previous = value;
    }
    await this.store.save(source.region, answer);
    return answer.length;
  }

  /** The earlier of the first month anyone needs and a year ago. */
  private async startAnchor(thisMonth: MonthKey): Promise<MonthKey> {
    const yearAgo = addMonths(thisMonth, -12);
    const needed = await this.firstNeededMonth();
    return needed !== null && needed < yearAgo ? needed : yearAgo;
  }

  /** The stored value of the newest month before `month`, to bound the answer's first move. */
  private async storedBefore(region: IndexRegion, month?: MonthKey): Promise<number | undefined> {
    if (month === undefined) return undefined;
    const { months } = (await this.store.all())[region];
    return months.filter((m) => m.month < month).at(-1)?.value;
  }
}
