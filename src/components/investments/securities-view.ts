import { Pricing, SecurityType } from '@/lib/investments/codes';
import type { SecurityListItem } from '@/lib/investments/security-list';
import { plural } from './account-states';
import { fmtDay, fmtMoney } from './format';

/**
 * How a security is priced. `name` is the source alone (the window's "Currently" line, which shows
 * the price itself); `main` is the row's label, which adds the price for Manual and Fixed.
 */
export type PriceSourceView = { name: string; main: string; detail: string | null; warn: boolean };
/** The latest price as shown: money in the security's currency, and its day (none for Fixed). */
export type LatestView = { price: string; date: string | null };

export function latestView(s: SecurityListItem): LatestView | null {
  if (!s.latest) return null;
  return {
    price: fmtMoney(s.latest.price, { cents: true, currency: s.currency }),
    date: s.latest.date ? fmtDay(s.latest.date) : null,
  };
}

const source = (
  name: string,
  detail: string | null = null,
  main: string = name
): PriceSourceView => ({ name, main, detail, warn: false });

/** A source whose row label carries its price (Manual, Fixed). */
const withPrice = (name: string, latest: LatestView | null) =>
  latest ? `${name} · ${latest.price}` : name;

const SOURCE_VIEWS: Record<
  Pricing,
  (s: SecurityListItem, latest: LatestView | null) => PriceSourceView
> = {
  [Pricing.Market]: (s) => source(s.priceSymbol ? `Market · ${s.priceSymbol}` : 'Market'),
  [Pricing.Institution]: (s) =>
    source(s.proxySymbol ? `Institution · follows ${s.proxySymbol}` : 'Institution'),
  [Pricing.Manual]: (_s, latest) =>
    source('Manual', latest?.date ? `Entered ${latest.date}` : null, withPrice('Manual', latest)),
  [Pricing.Fixed]: (_s, latest) => source('Fixed', null, withPrice('Fixed', latest)),
  [Pricing.None]: () => ({
    ...source('No price source', 'Valued at its last known price'),
    warn: true,
  }),
};

/** How a security is priced, in words (spec §3); unknown stored values read as None. */
export function priceSourceView(s: SecurityListItem): PriceSourceView {
  const view = SOURCE_VIEWS[s.pricing] ?? SOURCE_VIEWS[Pricing.None];
  return view(s, latestView(s));
}

/**
 * The row's second line: the name, unless it repeats the label. Cash reads by its currency alone,
 * so its (often long or internal) name is hidden.
 */
export function nameLine(s: SecurityListItem): string | null {
  return s.type === SecurityType.Cash || s.name === s.label ? null : s.name;
}

/** Settings → Securities, scrolled to and highlighting one security. */
export const securitySettingsHref = (securityId: string) =>
  `/settings?tab=securities&security=${encodeURIComponent(securityId)}`;

const TYPE_LABELS: Record<SecurityType, string> = {
  [SecurityType.Etf]: 'ETF',
  [SecurityType.Equity]: 'Stock',
  [SecurityType.MutualFund]: 'Fund',
  [SecurityType.MoneyMarket]: 'Money market',
  [SecurityType.Cash]: 'Cash',
  [SecurityType.Crypto]: 'Crypto',
  [SecurityType.Other]: 'Other',
};

/** The Type column; an unknown stored type reads Other. */
export const typeLabel = (type: SecurityType): string => TYPE_LABELS[type] ?? 'Other';

/** The Held in column. */
export const heldInText = (accounts: number): string =>
  accounts === 0 ? 'Not held' : plural(accounts, 'account');

/** No price source; the one rule behind the row's warning colour and Needs attention. */
export const isUnpriced = (s: SecurityListItem): boolean => priceSourceView(s).warn;

export type SecurityFilter = 'all' | 'attention';

/** The segmented toggle; Needs attention means no price source. */
export const SECURITY_FILTERS: {
  id: SecurityFilter;
  label: string;
  keeps: (s: SecurityListItem) => boolean;
}[] = [
  { id: 'all', label: 'All', keeps: () => true },
  { id: 'attention', label: 'Needs attention', keeps: isUnpriced },
];

/** The rows a filter and a search (ticker or name, any case) leave. */
export function filterSecurities(
  items: SecurityListItem[],
  filter: SecurityFilter,
  query: string
): SecurityListItem[] {
  const keeps = SECURITY_FILTERS.find((f) => f.id === filter)?.keeps ?? (() => true);
  const q = query.trim().toLowerCase();
  return items.filter(
    (s) => keeps(s) && (!q || [s.label, s.name].some((v) => v.toLowerCase().includes(q)))
  );
}
