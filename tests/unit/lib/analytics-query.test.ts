import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  capped,
  defaultQuery,
  filterParamsFor,
  parseAnalyticsQuery,
  toSearchParams,
  type AnalyticsQuery,
} from '@/lib/analytics-query';
import { UNCATEGORIZED } from '@/lib/transaction-filters';
import { localDay } from '@/lib/dates';
import { freezeClock, inNewYork } from '../../helpers/time-zone';

const TODAY = '2026-11-07';
const parse = (qs: string) => parseAnalyticsQuery(new URLSearchParams(qs), TODAY);

describe('analytics query in the address', () => {
  inNewYork();

  it('roundTripsEveryField', () => {
    const queries: AnalyticsQuery[] = [
      {
        period: { kind: '3m', anchor: '2026-09' },
        vs: 'lastYear',
        categories: ['c1', UNCATEGORIZED],
        accounts: ['a1', 'a2'],
        tags: ['trip'],
        merchant: 'whole foods',
      },
      { ...defaultQuery(TODAY), period: { kind: 'year', anchor: '2025-12' }, vs: 'none' },
      {
        ...defaultQuery(TODAY),
        period: {
          kind: 'custom',
          anchor: '2026-10',
          custom: { start: '2026-09-15', end: '2026-10-20' },
        },
      },
    ];
    for (const q of queries) {
      expect(parseAnalyticsQuery(toSearchParams(q, TODAY), TODAY)).toEqual(q);
    }
  });

  it('emptyAddressIsDefault', () => {
    const q = parse('');
    expect(q.period).toEqual({ kind: 'month', anchor: '2026-11' });
    expect(q.vs).toBe('prev');
    expect(q.categories).toEqual([]);
    expect(q.accounts).toEqual([]);
    expect(q.tags).toEqual([]);
    expect(q.merchant).toBe('');
  });

  it('defaultsAreLeftOut', () => {
    expect(toSearchParams(defaultQuery(TODAY), TODAY).toString()).toBe('');
  });

  it('usesTheAgreedNames', () => {
    const q = parse(
      'period=3m&at=2026-09&vs=lastYear&category=c1&category=c2&account=a&tag=t&merchant=x'
    );
    expect(toSearchParams(q, TODAY).toString()).toBe(
      'period=3m&at=2026-09&vs=lastYear&category=c1&category=c2&account=a&tag=t&merchant=x'
    );
  });

  it('badValuesFallBack', () => {
    const q = parse('period=week&at=2026-13&vs=x');
    expect(q.period).toEqual({ kind: 'month', anchor: '2026-11' });
    expect(q.vs).toBe('prev');
    expect(parse('period=custom&from=nope&to=2026-10-01').period.kind).toBe('month');
    expect(parse('period=custom&from=2026-10-01').period.kind).toBe('month');
  });

  it('customFromAfterTodayFallsBack', () => {
    expect(parse('period=custom&from=2026-11-08&to=2026-11-20').period).toEqual({
      kind: 'month',
      anchor: '2026-11',
    });
  });

  it('impossibleCustomDayFallsBack', () => {
    expect(parse('period=custom&from=2026-02-30&to=2026-03-05').period).toEqual({
      kind: 'month',
      anchor: '2026-11',
    });
    expect(parse('period=custom&from=2026-03-01&to=2026-04-31').period.kind).toBe('month');
  });

  it('emptyFilterValuesAreDropped', () => {
    const q = parse('tag=&category=&account=&merchant=');
    expect(activeFilterCount(q)).toBe(0);
    expect(q.tags).toEqual([]);
  });

  it('customFromAfterToFallsBack', () => {
    expect(parse('period=custom&from=2026-10-20&to=2026-10-01').period.kind).toBe('month');
  });

  it('customToAfterTodayIsKept', () => {
    expect(parse('period=custom&from=2026-11-01&to=2026-12-31').period).toEqual({
      kind: 'custom',
      anchor: '2026-12',
      custom: { start: '2026-11-01', end: '2026-12-31' },
    });
  });

  it('futureAtIsClamped', () => {
    expect(parse('at=2027-03').period.anchor).toBe('2026-11');
    expect(parse('period=3m&at=2027-03').period.anchor).toBe('2026-11');
    expect(parse('period=year&at=2027-12').period.anchor).toBe('2026-12');
  });

  it('filterParamsForCarriesRangeAndOnlyNonEmptyFilters', () => {
    const r = { start: '2026-11-01', end: '2026-11-07' };
    expect(filterParamsFor(defaultQuery(TODAY), r)).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    });
    expect(
      filterParamsFor({ ...defaultQuery(TODAY), categories: ['c1'], tags: ['t'], merchant: 'x' }, r)
    ).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      categories: ['c1'],
      tags: ['t'],
      merchant: 'x',
    });
  });

  it('countsEachActiveFilterOnce', () => {
    expect(activeFilterCount(defaultQuery(TODAY))).toBe(0);
    expect(
      activeFilterCount({
        ...defaultQuery(TODAY),
        categories: ['a', 'b'],
        accounts: ['x'],
        tags: [],
        merchant: 'm',
      })
    ).toBe(3);
  });

  it('cappedChipText', () => {
    expect(capped([])).toBe('Any');
    expect(capped(['Groceries'])).toBe('Groceries');
    expect(capped(['Groceries', 'Dining'])).toBe('Groceries +1');
    expect(capped(['Golf', 'A', 'B'])).toBe('Golf +2');
  });

  it('defaultsToLocalMonthLateEvening', () => {
    freezeClock('2026-12-01T03:30:00.000Z');
    expect(defaultQuery(localDay()).period.anchor).toBe('2026-11');
  });
});
