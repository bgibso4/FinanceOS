import { describe, it, expect } from 'vitest';
import { allocation, holdingLines, type HoldingRow } from '@/lib/investments/holdings-view';

const row = (over: Partial<HoldingRow>): HoldingRow => ({
  accountId: 'a1',
  securityId: 's1',
  kind: 'security',
  label: 'AAA',
  name: 'Triple A Fund',
  type: 'etf',
  pricing: 'feed',
  currency: 'USD',
  quantity: 10,
  price: 10,
  priceInAccount: 10,
  value: 100,
  valueBase: 100,
  gainBase: 20,
  rangeChangePct: 5,
  ...over,
});

describe('holdingLines', () => {
  it('aggregates a security across accounts and counts the accounts', () => {
    const lines = holdingLines([
      row({}),
      row({ accountId: 'a2', quantity: 5, valueBase: 50, gainBase: 5 }),
      row({ securityId: 's2', label: 'BBB', valueBase: 50, gainBase: null }),
    ]);
    expect(
      lines.map((l) => [l.label, l.valueBase, l.quantity, l.accountCount, l.gainBase])
    ).toEqual([
      ['AAA', 150, 15, 2, 25],
      ['BBB', 50, 10, 1, null],
    ]);
    expect(lines[0].weightPct).toBe(75);
  });

  it('needs every position to have cost basis to show a gain', () => {
    const [line] = holdingLines([row({}), row({ accountId: 'a2', gainBase: null })]);
    expect(line.gainBase).toBeNull();
  });

  it('merges cash and money market into one line without a quantity', () => {
    const lines = holdingLines([
      row({ securityId: 'c1', kind: 'cash', label: 'Cash', type: 'cash', valueBase: 30 }),
      row({
        securityId: 'm1',
        kind: 'cash',
        label: 'Money market',
        type: 'money_market',
        valueBase: 20,
      }),
    ]);
    expect(lines).toEqual([
      expect.objectContaining({
        key: 'cash',
        label: 'Cash & money market',
        quantity: null,
        valueBase: 50,
      }),
    ]);
  });

  it('hides positions worth a dollar or less and flags unpriced ones', () => {
    const lines = holdingLines([
      row({ valueBase: 0.5 }),
      row({ securityId: 's2', label: 'ZZZ', pricing: 'none', valueBase: 10 }),
    ]);
    expect(lines.map((l) => [l.label, l.unpriced])).toEqual([['ZZZ', true]]);
  });
});

describe('allocation', () => {
  const accounts = [
    { id: 'a1', wrapper: '401(k)', currency: 'USD' },
    { id: 'a2', wrapper: 'Cash mgmt', currency: 'CAD' },
  ];
  const rows = [
    row({ valueBase: 60 }),
    row({ accountId: 'a2', securityId: 'c1', kind: 'cash', type: 'cash', valueBase: 40 }),
  ];

  it('splits by security type', () => {
    expect(allocation(rows, accounts, 'type')).toEqual([
      { label: 'ETF', value: 60, pct: 60 },
      { label: 'Cash & MM', value: 40, pct: 40 },
    ]);
  });

  it('splits by account bucket and by currency', () => {
    expect(allocation(rows, accounts, 'account').map((s) => s.label)).toEqual([
      '401(k)',
      'Taxable',
    ]);
    expect(allocation(rows, accounts, 'currency').map((s) => [s.label, s.pct])).toEqual([
      ['USD', 60],
      ['CAD', 40],
    ]);
  });

  it('is empty when nothing is held', () => {
    expect(allocation([], accounts, 'type')).toEqual([]);
  });
});
