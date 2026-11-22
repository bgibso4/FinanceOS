import { isoDay } from './dates';

export type ActivityInput = {
  id: string;
  accountId: string;
  date: Date;
  type: string;
  subtype: string;
  name: string;
  quantity: number | null;
  price: number | null;
  amount: number; // aggregator sign: positive = cash leaves the account
  currency: string;
  securityId: string | null;
  ticker: string | null;
  securityName: string | null;
};

export type ActivityItem = {
  id: string;
  accountId: string;
  date: string;
  /** What happened: Buy, Sell, Dividend, Interest… or the institution's own description. */
  kind: string;
  /** The security's ticker, else its name; null for cash events. */
  symbol: string | null;
  /** The security's full name when `symbol` is its ticker. */
  securityName: string | null;
  /** Shares traded and their price, in `currency`. */
  trade: { quantity: number; price: number } | null;
  amount: number; // positive = cash into the account
  /** The transaction's own currency: activity is a cash event in the account, never converted. */
  currency: string;
};

const symbolOf = (r: ActivityInput) => r.ticker ?? r.securityName ?? null;
const isDividend = (r: ActivityInput) => r.type === 'cash' && r.subtype.includes('dividend');

type Label = Pick<ActivityItem, 'kind' | 'symbol' | 'securityName'>;
const named = (kind: string, r: ActivityInput): Label => ({
  kind,
  symbol: symbolOf(r),
  securityName: r.ticker ? r.securityName : null,
});
const plain = (kind: string): Label => ({ kind, symbol: null, securityName: null });

/** First matching rule names the event; unknown events keep the institution's description. */
const LABEL_RULES: { match: (r: ActivityInput) => boolean; label: (r: ActivityInput) => Label }[] =
  [
    { match: (r) => r.type === 'buy', label: (r) => named('Buy', r) },
    { match: (r) => r.type === 'sell', label: (r) => named('Sell', r) },
    { match: isDividend, label: (r) => named('Dividend', r) },
    { match: (r) => r.subtype.includes('interest'), label: () => plain('Interest') },
    { match: (r) => r.type === 'fee' || r.subtype.includes('fee'), label: () => plain('Fee') },
    { match: (r) => r.subtype === 'contribution', label: () => plain('Contribution') },
    { match: (r) => r.subtype === 'deposit', label: () => plain('Deposit') },
    { match: (r) => r.subtype === 'withdrawal', label: () => plain('Withdrawal') },
    { match: (r) => r.subtype === 'income', label: () => plain('Income') },
    {
      match: (r) => r.type === 'transfer' || r.subtype.startsWith('transfer'),
      label: (r) => plain(r.amount < 0 ? 'Transfer in' : 'Transfer out'),
    },
  ];

const labelOf = (r: ActivityInput) =>
  LABEL_RULES.find((rule) => rule.match(r))?.label(r) ?? plain(r.name);

/** Shares and price, when shares changed hands; cash events report a zero quantity. */
const tradeOf = (r: ActivityInput): ActivityItem['trade'] =>
  r.quantity && r.price != null ? { quantity: Math.abs(r.quantity), price: r.price } : null;

const sameDaySecurity = (a: ActivityInput, b: ActivityInput) =>
  a.accountId === b.accountId &&
  a.securityId != null &&
  a.securityId === b.securityId &&
  a.date.getTime() === b.date.getTime();

/** Investment activity for display, newest first, with dividend reinvestments merged. */
export function buildActivity(rows: ActivityInput[]): ActivityItem[] {
  // Dividends first, so each claims its reinvestment before that buy could be listed alone.
  const ordered = [...rows].sort((a, b) => Number(isDividend(b)) - Number(isDividend(a)));
  const used = new Set<string>();
  const items: ActivityItem[] = [];
  for (const r of ordered) {
    if (used.has(r.id)) continue;
    const reinvest = isDividend(r)
      ? ordered.find((b) => b.type === 'buy' && !used.has(b.id) && sameDaySecurity(r, b))
      : undefined;
    used.add(r.id);
    if (reinvest) used.add(reinvest.id);
    items.push({
      id: r.id,
      accountId: r.accountId,
      date: isoDay(r.date),
      ...(reinvest ? named('Dividend reinvested', r) : labelOf(r)),
      trade: tradeOf(reinvest ?? r),
      amount: -r.amount,
      currency: r.currency,
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
