import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { fixedClock } from '@/lib/clock';
import { PriceIndexStore } from '@/lib/price-index/store';
import { PriceIndexHistory } from '@/lib/price-index/history';
import { addMonths } from '@/lib/price-index/months';
import {
  PriceIndexSourceError,
  type IndexObservation,
  type IndexRegion,
  type MonthKey,
  type PriceIndexSource,
} from '@/lib/price-index/types';

/** Records what it is asked and answers with preset observations (or throws). */
class FakeSource implements PriceIndexSource {
  readonly attribution = 'fake';
  calls: { from: MonthKey; to: MonthKey }[] = [];
  constructor(
    readonly region: IndexRegion,
    private answer: IndexObservation[] | Error = []
  ) {}
  async fetchMonths(from: MonthKey, to: MonthKey) {
    this.calls.push({ from, to });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

/** Gently rising index values for each month from..to inclusive. */
function series(from: MonthKey, to: MonthKey, start = 300): IndexObservation[] {
  const out: IndexObservation[] = [];
  for (let m = from, i = 0; m <= to; m = addMonths(m, 1), i++) {
    out.push({ month: m, value: start + i });
  }
  return out;
}

describe('PriceIndexHistory', () => {
  let prisma: PrismaClient;
  let store: PriceIndexStore;
  const clock = fixedClock('2026-11-08T12:00:00Z');

  beforeAll(async () => {
    prisma = await setupTestDb();
    store = new PriceIndexStore(prisma);
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.restoreAllMocks();
  });

  const historyFor = (sources: PriceIndexSource[], firstNeeded: MonthKey | null = null) =>
    new PriceIndexHistory(store, sources, async () => firstNeeded, clock);

  it('firstFillWithoutSnapshotsFetches24Months', async () => {
    const us = new FakeSource('US', series('2024-11', '2026-09'));
    const result = await historyFor([us]).fill();
    expect(us.calls).toEqual([{ from: '2024-11', to: '2026-11' }]);
    expect(result).toEqual({ regions: ['US'], months: 23, failed: [] });
  });

  it('firstFillStartsBeforeFirstSnapshot', async () => {
    const us = new FakeSource('US', series('2023-04', '2026-09'));
    await historyFor([us], '2024-04').fill();
    expect(us.calls).toEqual([{ from: '2023-04', to: '2026-11' }]);
  });

  it('skipsWhenNothingNewPossible', async () => {
    await store.save('US', [{ month: '2026-10', value: 320 }]);
    const us = new FakeSource('US', new Error('must not be called'));
    const result = await historyFor([us]).fill();
    expect(us.calls).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('rereadsRecentMonthsForRevisions', async () => {
    await store.save('US', [
      { month: '2026-07', value: 310 },
      { month: '2026-08', value: 311 },
    ]);
    const us = new FakeSource('US', [
      { month: '2026-07', value: 310.5 },
      { month: '2026-08', value: 311 },
      { month: '2026-09', value: 312 },
    ]);
    await historyFor([us]).fill();
    expect(us.calls).toEqual([{ from: '2026-05', to: '2026-11' }]);
    const months = (await store.all()).US.months;
    expect(months).toEqual([
      { month: '2026-07', value: 310.5 },
      { month: '2026-08', value: 311 },
      { month: '2026-09', value: 312 },
    ]);
  });

  it.each([
    ['zero', [{ month: '2026-08', value: 0 }]],
    ['NaN', [{ month: '2026-08', value: NaN }]],
    [
      'a 6% jump',
      [
        { month: '2026-08', value: 300 },
        { month: '2026-09', value: 318 },
      ],
    ],
  ])('nonsenseWritesNothing (%s)', async (_label, answer) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await historyFor([new FakeSource('US', answer)]).fill();
    expect(result.failed).toEqual(['US']);
    expect(await prisma.priceIndexMonth.count()).toBe(0);
  });

  it('rejectsAJumpFromTheStoredMonth', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.save('US', [{ month: '2026-07', value: 300 }]);
    const us = new FakeSource('US', [{ month: '2026-08', value: 320 }]);
    const result = await historyFor([us]).fill();
    expect(result.failed).toEqual(['US']);
    expect((await store.all()).US.months).toHaveLength(1);
  });

  it('oneRegionFailingDoesNotStopOther', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const us = new FakeSource('US', new PriceIndexSourceError('limit reached'));
    const ca = new FakeSource('CA', series('2026-08', '2026-09', 160));
    const result = await historyFor([us, ca]).fill();
    expect(result).toEqual({ regions: ['US', 'CA'], months: 2, failed: ['US'] });
    const all = await store.all();
    expect(all.US.months).toEqual([]);
    expect(all.CA.months).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[price-index] US'));
  });

  it('storeAllReturnsFetchedAt', async () => {
    await store.save('US', [
      { month: '2026-09', value: 312 },
      { month: '2026-08', value: 311 },
    ]);
    const all = await store.all();
    expect(all.US.fetchedAt).toBeInstanceOf(Date);
    expect(all.US.months.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(all.CA).toEqual({ months: [], fetchedAt: null });
    expect(await store.lastMonth('US')).toBe('2026-09');
    expect(await store.lastMonth('CA')).toBeNull();
  });
});
