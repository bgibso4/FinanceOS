import { describe, it, expect } from 'vitest';
import { leftOutText, parseAmount, rowTag, scaleNotes } from '@/components/investments/invest-view';
import type { PlanRow } from '@/lib/investments/targets/planner';

const row = (className: string | null, name: string) => ({ className, name }) as PlanRow;

describe('parseAmount', () => {
  it('strips $ and commas', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('$1,000')).toBe(1000);
    expect(parseAmount(' $ 2,500.50 ')).toBe(2500.5);
  });
  it('is null for empty, negative or invalid text', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('rowTag', () => {
  it('joins class and region, or shows the class alone', () => {
    expect(rowTag(row('Stocks', 'US'))).toBe('Stocks · US');
    expect(rowTag(row(null, 'Fixed income'))).toBe('Fixed income');
  });
});

describe('leftOutText', () => {
  it('words every reason', () => {
    expect(leftOutText('account_excluded')).toBe('Account left out');
    expect(leftOutText('typed_balance')).toBe('Typed-in balance, no funds to count');
    expect(leftOutText('cash')).toBe('Cash waiting to be invested');
    expect(leftOutText('not_counted')).toBe('Not counted toward a target');
  });
});

describe('scaleNotes', () => {
  it('notes a total that is not 100', () => {
    expect(scaleNotes({ countryWeightPct: 99.34, classPct: 100 })).toEqual([
      'Your country weights add to 99.34%; scaled to 100%.',
    ]);
    expect(scaleNotes({ countryWeightPct: 100, classPct: 95 })).toEqual([
      'Your class targets add to 95.00%; scaled to 100%.',
    ]);
  });
  it('says nothing at 100', () => {
    expect(scaleNotes({ countryWeightPct: 100.001, classPct: 100 })).toEqual([]);
  });
});
