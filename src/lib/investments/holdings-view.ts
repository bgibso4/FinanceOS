import { SecurityType } from './codes';
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

/** One account's share of a holdings line. */
export type HoldingMember = {
  accountId: string;
  quantity: number | null;
  valueBase: number;
  gainBase: number | null;
  /** Share of the whole portfolio shown. */
  weightPct: number;
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
  weightPct: number;
  /** One per account holding it, largest first. */
  members: HoldingMember[];
};

export const CASH_KEY = 'cash';
export const CASH_LABEL = 'Cash & money market';
const MIN_SHOWN_VALUE = 1;

const lineKey = (r: HoldingRow) => (r.kind === 'cash' ? CASH_KEY : r.securityId);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Totals over rows of one security (or of cash): value, gain only when every row has one. */
function totals(rows: HoldingRow[]) {
  const gains = rows.map((r) => r.gainBase);
  return {
    quantity: rows[0].kind === 'security' ? rows.reduce((sum, r) => sum + r.quantity, 0) : null,
    valueBase: roundCents(rows.reduce((sum, r) => sum + r.valueBase, 0)),
    gainBase: gains.every((g) => g != null)
      ? roundCents(gains.reduce((sum: number, g) => sum + g!, 0))
      : null,
  };
}

/** Holdings lines for the given rows: grouped by security, cash merged, sorted by value. */
export function holdingLines(rows: HoldingRow[]): HoldingLine[] {
  const lines = [...groupBy(rows, lineKey).entries()].map(([key, group]) => {
    const first = group[0];
    const isCash = key === CASH_KEY;
    const members = [...groupBy(group, (r) => r.accountId).entries()]
      .map(([accountId, own]) => ({ accountId, ...totals(own), weightPct: 0 }))
      .sort((a, b) => b.valueBase - a.valueBase);
    // The parent is the sum of its rounded members, so the sub-lines add up to it exactly.
    const gains = members.map((m) => m.gainBase);
    return {
      key,
      label: isCash ? CASH_LABEL : first.label,
      name: isCash ? CASH_LABEL : first.name,
      kind: first.kind,
      securityId: isCash ? null : first.securityId,
      quantity: totals(group).quantity,
      valueBase: roundCents(members.reduce((sum, m) => sum + m.valueBase, 0)),
      gainBase: gains.every((g) => g != null)
        ? roundCents(gains.reduce((sum: number, g) => sum + g!, 0))
        : null,
      rangeChangePct: first.rangeChangePct,
      accountCount: members.length,
      weightPct: 0,
      members,
    };
  });

  const shown = lines.filter((l) => l.valueBase > MIN_SHOWN_VALUE);
  const total = shown.reduce((sum, l) => sum + l.valueBase, 0);
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  return shown
    .map((l) => ({
      ...l,
      weightPct: pct(l.valueBase),
      members: l.members.map((m) => ({ ...m, weightPct: pct(m.valueBase) })),
    }))
    .sort((a, b) => b.valueBase - a.valueBase);
}

export type AllocationDimension = 'type' | 'account' | 'currency';
export type AllocationSlice = { label: string; value: number; pct: number };

export const TYPE_LABELS: Record<string, string> = {
  [SecurityType.Etf]: 'ETF',
  [SecurityType.Equity]: 'Stock',
  [SecurityType.MutualFund]: 'Mutual fund',
  [SecurityType.Cash]: 'Cash & MM',
  [SecurityType.MoneyMarket]: 'Cash & MM',
  [SecurityType.Crypto]: 'Crypto',
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
