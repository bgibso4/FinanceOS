import { addDays, isoDay, utcDay } from '@/lib/investments/dates';
import type { HoldingRow } from '@/lib/investments/holdings-view';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';

/** Daily points from `start`; indexes in `estimated` are estimates. */
export const series = (values: number[], estimated: number[] = [], start = '2026-10-01') =>
  values.map((value, i) => ({
    date: isoDay(addDays(utcDay(start), i)),
    value,
    isEstimated: estimated.includes(i),
  }));

export function makeAccount(over: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'acc-plaid',
    name: 'Brokerage',
    institution: 'Test Bank',
    group: 'Taxable',
    wrapper: 'Taxable',
    currency: 'USD',
    balanceSource: 'provider',
    value: 1100,
    valueBase: 1100,
    asOf: '2026-10-09',
    lastSyncAt: '2026-10-09T13:24:00.000Z',
    enrollmentId: 'enr-1',
    series: series([1000, 1050, 1100]),
    change: { start: 1000, end: 1100, delta: 100, pct: 10 },
    prices: null,
    status: { needsReauth: null, waiting: null, unpriced: [], tradesReported: true },
    ...over,
  };
}

export function makeHolding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    accountId: 'acc-plaid',
    securityId: 'sec-aaa',
    kind: 'security',
    label: 'AAA',
    name: 'Triple A Fund',
    type: 'etf',
    pricing: 'feed',
    currency: 'USD',
    quantity: 10,
    price: 110,
    priceInAccount: 110,
    value: 1100,
    valueBase: 1100,
    gainBase: 100,
    rangeChangePct: 10,
    ...over,
  };
}

export function makeOverview(over: Partial<InvestmentOverview> = {}): InvestmentOverview {
  const accounts = over.accounts ?? [makeAccount()];
  return {
    range: '3M',
    today: '2026-10-09',
    baseCurrency: 'USD',
    prices: { asOf: '2026-10-09', stale: false },
    portfolio: {
      value: accounts.reduce((sum, a) => sum + a.valueBase, 0),
      series: series([1000, 1050, 1100]),
      change: { start: 1000, end: 1100, delta: 100, pct: 10 },
    },
    accounts,
    holdings: [makeHolding()],
    activity: [],
    ...over,
  };
}
