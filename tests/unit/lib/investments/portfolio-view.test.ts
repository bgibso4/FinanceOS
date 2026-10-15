import { describe, it, expect } from 'vitest';
import { isoDay, utcDay } from '@/lib/investments/dates';
import {
  accountGroup,
  allocationBucket,
  isRange,
  rangeStart,
  seriesChange,
  wrapperLabel,
} from '@/lib/investments/portfolio-view';

describe('rangeStart', () => {
  const today = utcDay('2026-10-11');
  it.each([
    ['1M', '2026-09-11'],
    ['3M', '2026-07-12'],
    ['1Y', '2025-10-11'],
    ['3Y', '2023-10-12'],
    ['YTD', '2026-01-01'],
  ] as const)('%s starts on %s', (range, expected) => {
    expect(isoDay(rangeStart(range, today))).toBe(expected);
  });
});

describe('isRange', () => {
  it('accepts the six ranges only', () => {
    expect(isRange('YTD')).toBe(true);
    expect(isRange('3Y')).toBe(true);
    expect(isRange('All')).toBe(true);
    expect(isRange('5Y')).toBe(false);
    expect(isRange(undefined)).toBe(false);
  });
});

describe('accountGroup', () => {
  it('groups by account type', () => {
    expect(accountGroup('retirement')).toBe('Retirement');
    expect(accountGroup('crypto')).toBe('Crypto');
    expect(accountGroup('brokerage')).toBe('Taxable');
    expect(accountGroup('cash')).toBe('Taxable');
  });
});

describe('wrapperLabel', () => {
  it('names the wrapper from the Plaid subtype', () => {
    expect(wrapperLabel('401k', 'retirement')).toBe('401(k)');
    expect(wrapperLabel('roth', 'brokerage')).toBe('Roth IRA');
    expect(wrapperLabel('cash management', 'cash')).toBe('Cash mgmt');
  });
  it('falls back to the group without a known subtype', () => {
    expect(wrapperLabel(null, 'retirement')).toBe('Retirement');
    expect(wrapperLabel('something new', 'brokerage')).toBe('Taxable');
  });
});

describe('allocationBucket', () => {
  it('folds cash management into Taxable and drops a Group prefix', () => {
    expect(allocationBucket('Cash mgmt')).toBe('Taxable');
    expect(allocationBucket('Group RRSP')).toBe('RRSP');
    expect(allocationBucket('HSA')).toBe('HSA');
  });
});

describe('seriesChange', () => {
  it('compares the first and last points', () => {
    expect(seriesChange([{ value: 100 }, { value: 90 }, { value: 110 }])).toEqual({
      start: 100,
      end: 110,
      delta: 10,
      pct: 10,
    });
  });
  it('has no percentage from a zero start, and nothing under two points', () => {
    expect(seriesChange([{ value: 0 }, { value: 5 }])?.pct).toBeNull();
    expect(seriesChange([])).toBeNull();
    expect(seriesChange([{ value: 100 }])).toBeNull();
  });
});
