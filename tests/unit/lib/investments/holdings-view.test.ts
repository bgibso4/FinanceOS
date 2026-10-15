import { describe, it, expect } from 'vitest';
import { allocation, holdingLines, type HoldingRow } from '@/lib/investments/holdings-view';
import { Pricing, SecurityType } from '@/lib/investments/codes';

const row = (over: Partial<HoldingRow>): HoldingRow => ({
  accountId: 'a1',
  securityId: 's1',
  kind: 'security',
  label: 'AAA',
  name: 'Triple A Fund',
  type: 'etf',
  pricing: Pricing.Market,
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
  it('splits a line into one member per account, by value, summing to the line', () => {
    const lines = holdingLines([
      row({ valueBase: 30, gainBase: 3, quantity: 3 }),
      row({ accountId: 'a2', quantity: 7, valueBase: 70, gainBase: null }),
      row({ securityId: 's2', label: 'BBB', valueBase: 100 }),
    ]);
    const aaa = lines.find((l) => l.key === 's1')!;
    expect(aaa.members).toEqual([
      { accountId: 'a2', quantity: 7, valueBase: 70, gainBase: null, weightPct: 35 },
      { accountId: 'a1', quantity: 3, valueBase: 30, gainBase: 3, weightPct: 15 },
    ]);
    expect(aaa.members.reduce((sum, m) => sum + m.valueBase, 0)).toBeCloseTo(aaa.valueBase);
    expect(aaa.members.reduce((sum, m) => sum + m.weightPct, 0)).toBeCloseTo(aaa.weightPct);
  });

  it('groups cash and money market held in one account into one member', () => {
    const [cash] = holdingLines([
      row({
        securityId: 'c1',
        kind: 'cash',
        type: SecurityType.Cash,
        label: 'Cash',
        valueBase: 30,
        gainBase: null,
      }),
      row({
        securityId: 'm1',
        kind: 'cash',
        type: SecurityType.MoneyMarket,
        label: 'Money market',
        valueBase: 20,
        gainBase: null,
      }),
      row({
        accountId: 'a2',
        securityId: 'c2',
        kind: 'cash',
        type: SecurityType.Cash,
        label: 'Cash',
        valueBase: 50,
        gainBase: null,
      }),
    ]);
    expect(cash.accountCount).toBe(2);
    expect(cash.members.map((m) => [m.accountId, m.quantity, m.valueBase])).toEqual([
      ['a1', null, 50],
      ['a2', null, 50],
    ]);
  });

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

  it('hides positions worth a dollar or less', () => {
    const lines = holdingLines([
      row({ valueBase: 0.5 }),
      row({ securityId: 's2', label: 'ZZZ', pricing: Pricing.None, valueBase: 10 }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(['ZZZ']);
  });

  it('sums rounded members so sub-lines add up to the line exactly', () => {
    const [aaa] = holdingLines(
      ['a1', 'a2', 'a3'].map((accountId) => row({ accountId, valueBase: 10.004, gainBase: 1.004 }))
    );
    // Each member rounds to 10.00 / 1.00; rounding the raw sum would give 30.01 / 3.01.
    expect(aaa.members.map((m) => m.valueBase)).toEqual([10, 10, 10]);
    expect(aaa.valueBase).toBe(30);
    expect(aaa.gainBase).toBe(3);
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
