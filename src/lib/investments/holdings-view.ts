import { allocationBucket } from './portfolio-view';
import { roundCents } from './money';

export type HoldingKind = 'security' | 'cash' | 'account';

/** One current position in one account, priced (see `CurrentHoldingsReader`). */
export type HoldingRow = {
  accountId: string;
  securityId: string;
  kind: HoldingKind;
  label: string;
  name: string;
  type: string;
  pricing: string;
  currency: string;
  quantity: number;
  price: number;
  priceInAccount: number;
  value: number;
  valueBase: number;
  gainBase: number | null;
  rangeChangePct: number | null;
};

/** One row of the holdings table / treemap tile, possibly spanning accounts. */
export type HoldingLine = {
  key: string;
  label: string;
  name: string;
  kind: HoldingKind;
  securityId: string | null;
  quantity: number | null;
  valueBase: number;
  gainBase: number | null;
  rangeChangePct: number | null;
  accountCount: number;
  unpriced: boolean;
  weightPct: number;
};

export const CASH_KEY = 'cash';
export const CASH_LABEL = 'Cash & money market';
const MIN_SHOWN_VALUE = 1;

const lineKey = (r: HoldingRow) => (r.kind === 'cash' ? CASH_KEY : r.securityId);

/** Holdings lines for the given rows: grouped by security, cash merged, sorted by value. */
export function holdingLines(rows: HoldingRow[]): HoldingLine[] {
  const groups = new Map<string, HoldingRow[]>();
  for (const r of rows) groups.set(lineKey(r), [...(groups.get(lineKey(r)) ?? []), r]);

  const lines = [...groups.entries()].map(([key, members]) => {
    const first = members[0];
    const isCash = key === CASH_KEY;
    const gains = members.map((m) => m.gainBase);
    return {
      key,
      label: isCash ? CASH_LABEL : first.label,
      name: isCash ? CASH_LABEL : first.name,
      kind: first.kind,
      securityId: isCash ? null : first.securityId,
      quantity: first.kind === 'security' ? members.reduce((sum, m) => sum + m.quantity, 0) : null,
      valueBase: roundCents(members.reduce((sum, m) => sum + m.valueBase, 0)),
      gainBase: gains.every((g) => g != null)
        ? roundCents(gains.reduce((sum: number, g) => sum + g!, 0))
        : null,
      rangeChangePct: first.rangeChangePct,
      accountCount: new Set(members.map((m) => m.accountId)).size,
      unpriced: members.some((m) => m.pricing === 'none'),
      weightPct: 0,
    };
  });

  const shown = lines.filter((l) => l.valueBase > MIN_SHOWN_VALUE);
  const total = shown.reduce((sum, l) => sum + l.valueBase, 0);
  return shown
    .map((l) => ({ ...l, weightPct: total ? (l.valueBase / total) * 100 : 0 }))
    .sort((a, b) => b.valueBase - a.valueBase);
}

export type AllocationDimension = 'type' | 'account' | 'currency';
export type AllocationSlice = { label: string; value: number; pct: number };

export const TYPE_LABELS: Record<string, string> = {
  etf: 'ETF',
  equity: 'Stock',
  mutual_fund: 'Mutual fund',
  cash: 'Cash & MM',
  money_market: 'Cash & MM',
  crypto: 'Crypto',
};

type AccountFacts = { id: string; wrapper: string; currency: string };

const BUCKETS: Record<
  AllocationDimension,
  (row: HoldingRow, account: AccountFacts | undefined) => string
> = {
  type: (row) => TYPE_LABELS[row.type] ?? 'Other',
  account: (_row, account) => allocationBucket(account?.wrapper ?? 'Other'),
  currency: (_row, account) => account?.currency ?? 'Other',
};

/** Share of value by type, account bucket or currency, largest first. */
export function allocation(
  rows: HoldingRow[],
  accounts: AccountFacts[],
  dimension: AllocationDimension
): AllocationSlice[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  for (const r of rows) {
    const label = BUCKETS[dimension](r, byId.get(r.accountId));
    totals.set(label, (totals.get(label) ?? 0) + r.valueBase);
  }
  const total = [...totals.values()].reduce((sum, v) => sum + v, 0);
  return [...totals.entries()]
    .map(([label, value]) => ({
      label,
      value: roundCents(value),
      pct: total ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}
