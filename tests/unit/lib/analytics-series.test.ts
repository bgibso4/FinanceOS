import { describe, expect, it } from 'vitest';
import {
  assignColors,
  buildSeries,
  groupTotals,
  picksFor,
  soFar,
  type Pick,
} from '@/lib/analytics-series';
import { PIE_COLORS } from '@/lib/chart-colors';
import { UNCATEGORIZED } from '@/lib/transaction-filters';
import type { DaySpend } from '@/lib/analytics';
import type { Category } from '@/components/transactions/types';

const labels = { current: 'Nov', compare: 'Oct' };
const row = (date: string, categoryId: string | null, amount: number): DaySpend => ({
  date,
  categoryId,
  amount,
});
const NOV = { start: '2026-11-01', end: '2026-11-30' };
const OCT = { start: '2026-10-01', end: '2026-10-31' };
const base = {
  compare: null,
  shown: NOV,
  through: '2026-11-07',
  compareRange: null,
  running: false,
  categoryIds: null,
  labels,
};

const cats: Category[] = [
  { id: 'golf', name: 'Golf', type: 'expense' },
  { id: 'green', name: 'Green Fees', type: 'expense', parentId: 'golf' },
  { id: 'balls', name: 'Balls', type: 'expense', parentId: 'golf' },
  { id: 'cloth', name: 'Clothing', type: 'expense' },
];

describe('buildSeries', () => {
  it('dailyIsRunningTotalAndStopsAtToday', () => {
    const { points, lines, todayIndex } = buildSeries({
      ...base,
      current: [row('2026-11-01', 'a', 10), row('2026-11-03', 'a', 5)],
    });
    expect(points).toHaveLength(30);
    expect(points[0].values.current).toBe(10);
    expect(points[1].values.current).toBe(10);
    expect(points[2].values.current).toBe(15);
    expect(points[6].values.current).toBe(15);
    expect(points[7].values.current).toBeNull();
    expect(todayIndex).toBe(6);
    expect(lines).toEqual([
      { key: 'current', label: 'Nov', color: 'var(--accent)', dashed: false },
    ]);
  });

  it('compareRunsToItsOwnMonthEnd', () => {
    const { points, lines } = buildSeries({
      ...base,
      current: [row('2026-11-01', 'a', 1)],
      compare: [row('2026-10-01', 'a', 4), row('2026-10-31', 'a', 6)],
      compareRange: OCT,
    });
    expect(points).toHaveLength(31);
    expect(points.filter((p) => p.values.compare !== null)).toHaveLength(31);
    expect(points[0].values.compare).toBe(4);
    expect(points[30].values.compare).toBe(10);
    expect(points[30].values.current).toBeNull();
    expect(lines[1]).toEqual({
      key: 'compare',
      label: 'Oct',
      color: 'var(--text-muted)',
      dashed: true,
    });
  });

  it('monthlyAlignsComparisonByIndex', () => {
    const { points, todayIndex } = buildSeries({
      ...base,
      shown: { start: '2026-09-01', end: '2026-11-30' },
      through: '2026-11-07',
      current: [row('2026-09-15', 'a', 1), row('2026-10-02', 'a', 2), row('2026-11-02', 'a', 3)],
      compare: [row('2026-06-10', 'a', 7), row('2026-07-10', 'a', 8), row('2026-08-10', 'a', 9)],
      compareRange: { start: '2026-06-01', end: '2026-08-31' },
    });
    expect(points.map((p) => p.x)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(points.map((p) => p.values.current)).toEqual([1, 2, 3]);
    expect(points.map((p) => p.values.compare)).toEqual([7, 8, 9]);
    expect(todayIndex).toBeNull();
  });

  it('runningTotalAccumulates', () => {
    const { points } = buildSeries({
      ...base,
      running: true,
      shown: { start: '2026-09-01', end: '2026-11-30' },
      current: [row('2026-09-15', 'a', 1), row('2026-10-02', 'a', 2), row('2026-11-02', 'a', 3)],
    });
    expect(points.map((p) => p.values.current)).toEqual([1, 3, 6]);
  });

  it('monthlyBlanksMonthsAfterThrough', () => {
    const { points } = buildSeries({
      ...base,
      shown: { start: '2026-09-01', end: '2026-12-31' },
      current: [row('2026-09-15', 'a', 1)],
    });
    expect(points.map((p) => p.values.current)).toEqual([1, 0, 0, null]);
  });

  it('picksDrawOneLineEachAndHideComparison', () => {
    const picks: Pick[] = [
      { key: 'a', label: 'A', categoryIds: ['a'] },
      { key: 'b', label: 'B', categoryIds: ['b'] },
    ];
    const { points, lines } = buildSeries({
      ...base,
      picks,
      current: [row('2026-11-01', 'a', 1), row('2026-11-02', 'b', 9)],
      compare: [row('2026-10-01', 'a', 4)],
      compareRange: OCT,
    });
    expect(lines.map((l) => l.key)).toEqual(['b', 'a']);
    expect(lines.every((l) => !l.dashed)).toBe(true);
    expect(lines[0].color).toBe(PIE_COLORS[0]);
    expect(points).toHaveLength(30);
    expect(points[1].values).toEqual({ a: 1, b: 9 });
  });

  it('groupPickSumsItsCategories', () => {
    const { points } = buildSeries({
      ...base,
      picks: [
        { key: 'golf', label: 'Golf', categoryIds: ['green', 'balls'] },
        { key: 'cloth', label: 'Clothing', categoryIds: ['cloth'] },
      ],
      current: [row('2026-11-01', 'green', 3), row('2026-11-01', 'balls', 2)],
    });
    expect(points[0].values.golf).toBe(5);
    expect(points[0].values.cloth).toBe(0);
  });

  it('uncategorizedPick', () => {
    const { points } = buildSeries({
      ...base,
      picks: [
        { key: UNCATEGORIZED, label: 'Uncategorized', categoryIds: [null] },
        { key: 'a', label: 'A', categoryIds: ['a'] },
      ],
      current: [row('2026-11-01', null, 7), row('2026-11-01', 'a', 1)],
    });
    expect(points[0].values[UNCATEGORIZED]).toBe(7);
  });

  it('seriesTotalEqualsInputTotal', () => {
    const current = [
      row('2026-09-03', 'a', 1.5),
      row('2026-10-09', 'b', 2.25),
      row('2026-11-07', null, 3),
    ];
    const monthly = buildSeries({
      ...base,
      shown: { start: '2026-09-01', end: '2026-11-30' },
      current,
    });
    const sum = monthly.points.reduce((s, p) => s + (p.values.current ?? 0), 0);
    expect(sum).toBeCloseTo(6.75);
    const daily = buildSeries({
      ...base,
      current: [row('2026-11-01', 'a', 2), row('2026-11-05', 'b', 3)],
    });
    expect(daily.points[6].values.current).toBe(5);
  });

  it('categoryFilterAppliedClientSide', () => {
    const { points } = buildSeries({
      ...base,
      categoryIds: ['a', null],
      current: [row('2026-11-01', 'a', 1), row('2026-11-01', 'b', 10), row('2026-11-01', null, 2)],
    });
    expect(points[0].values.current).toBe(3);
  });
});

describe('picksFor', () => {
  it('fullyTickedGroupIsOnePick', () => {
    expect(picksFor(['green', 'balls', 'cloth'], cats)).toEqual([
      { key: 'golf', label: 'Golf', categoryIds: ['golf', 'green', 'balls'] },
      { key: 'cloth', label: 'Clothing', categoryIds: ['cloth'] },
    ]);
  });

  it('groupIdInSelectionDoesNotChangeThePick', () => {
    expect(picksFor(['golf', 'green', 'balls'], cats)).toHaveLength(1);
    expect(picksFor(['golf', 'green'], cats).map((p) => p.key)).toEqual(['green']);
  });

  it('groupPickIncludesParentBookedRows', () => {
    const rows = [row('2026-11-01', 'golf', 4), row('2026-11-01', 'green', 3)];
    const [pick] = picksFor(['green', 'balls'], cats);
    const { points } = buildSeries({
      ...base,
      current: rows,
      picks: [pick],
      categoryIds: pick.categoryIds,
    });
    expect(points[0].values.golf).toBe(groupTotals(rows, cats).golf);
  });

  it('partlyTickedGroupSplitsIntoCategories', () => {
    expect(picksFor(['green', 'cloth'], cats).map((p) => p.label)).toEqual([
      'Green Fees',
      'Clothing',
    ]);
  });

  it('uncategorizedPick', () => {
    expect(picksFor([UNCATEGORIZED], cats)).toEqual([
      { key: UNCATEGORIZED, label: 'Uncategorized', categoryIds: [null] },
    ]);
  });
});

describe('groupTotals', () => {
  it('groupTotalsSumTheirCategories', () => {
    expect(
      groupTotals(
        [
          row('2026-11-01', 'green', 3),
          row('2026-11-02', 'balls', 2),
          row('2026-11-02', 'cloth', 4),
          row('2026-11-03', null, 1),
        ],
        cats
      )
    ).toEqual({ golf: 5, cloth: 4, [UNCATEGORIZED]: 1 });
  });
});

describe('assignColors', () => {
  it('colorsFollowSpendRank', () => {
    const c = assignColors(['big', 'mid', 'small']);
    expect(c.big).toBe(PIE_COLORS[0]);
    expect(new Set(Object.values(c)).size).toBe(3);
  });
});

describe('soFar', () => {
  it('soFarReadsTodayAndEnd', () => {
    const built = buildSeries({
      ...base,
      current: [row('2026-11-02', 'a', 10)],
      compare: [row('2026-10-01', 'a', 3), row('2026-10-05', 'a', 4), row('2026-10-20', 'a', 5)],
      compareRange: OCT,
    });
    expect(soFar(built.points, built.lines)).toEqual({ now: 10, thenSameDay: 7, thenTotal: 12 });
  });

  it('nullWithoutComparison', () => {
    const built = buildSeries({ ...base, current: [] });
    expect(soFar(built.points, built.lines)).toBeNull();
  });
});
