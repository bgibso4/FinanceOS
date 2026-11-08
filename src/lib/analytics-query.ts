import type { CompareKind, DayRange, Period, PeriodKind } from './analytics-period';
import type { FilterParams } from './types';

/** What the Analytics page shows: a period, what it compares with, and the filters. */
export type AnalyticsQuery = {
  period: Period;
  vs: CompareKind;
  categories: string[];
  accounts: string[];
  tags: string[];
  merchant: string;
};

const KINDS: PeriodKind[] = ['month', '3m', 'year', 'custom'];
const COMPARES: CompareKind[] = ['prev', 'lastYear', 'none'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A real calendar day: 2026-02-30 is rejected, not rolled over to March 2. */
const isDay = (s: string | null): s is string => {
  if (s === null || !DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const nonEmpty = (values: string[]) => values.filter((v) => v !== '');

/** The anchor a period of this kind opens on: this month, or December of this year. */
const defaultAnchor = (kind: PeriodKind, today: string) =>
  kind === 'year' ? `${today.slice(0, 4)}-12` : today.slice(0, 7);

export const defaultQuery = (today: string): AnalyticsQuery => ({
  period: { kind: 'month', anchor: defaultAnchor('month', today) },
  vs: 'prev',
  categories: [],
  accounts: [],
  tags: [],
  merchant: '',
});

function parsePeriod(sp: URLSearchParams, today: string): Period {
  const kind = KINDS.find((k) => k === sp.get('period')) ?? 'month';
  if (kind === 'custom') {
    const from = sp.get('from');
    const to = sp.get('to');
    if (isDay(from) && isDay(to) && from <= to && from <= today) {
      return { kind, anchor: to.slice(0, 7), custom: { start: from, end: to } };
    }
    return defaultQuery(today).period;
  }
  const at = sp.get('at');
  const thisMonth = today.slice(0, 7);
  const month = at !== null && MONTH.test(at) && at <= thisMonth ? at : thisMonth;
  return { kind, anchor: kind === 'year' ? `${month.slice(0, 4)}-12` : month };
}

export function parseAnalyticsQuery(sp: URLSearchParams, today: string): AnalyticsQuery {
  return {
    period: parsePeriod(sp, today),
    vs: COMPARES.find((c) => c === sp.get('vs')) ?? 'prev',
    categories: nonEmpty(sp.getAll('category')),
    accounts: nonEmpty(sp.getAll('account')),
    tags: nonEmpty(sp.getAll('tag')),
    merchant: sp.get('merchant') ?? '',
  };
}

/** The address for a query; anything at its default is left out. */
export function toSearchParams(q: AnalyticsQuery, today: string): URLSearchParams {
  const sp = new URLSearchParams();
  const { kind, anchor, custom } = q.period;
  if (kind !== 'month') sp.set('period', kind);
  if (kind === 'custom' && custom) {
    sp.set('from', custom.start);
    sp.set('to', custom.end);
  } else if (anchor !== defaultAnchor(kind, today)) {
    sp.set('at', anchor);
  }
  if (q.vs !== 'prev') sp.set('vs', q.vs);
  q.categories.forEach((c) => sp.append('category', c));
  q.accounts.forEach((a) => sp.append('account', a));
  q.tags.forEach((t) => sp.append('tag', t));
  if (q.merchant) sp.set('merchant', q.merchant);
  return sp;
}

/** The shared filter parameters for a date range, carrying only the filters in use. */
export function filterParamsFor(q: AnalyticsQuery, r: DayRange): FilterParams {
  const params: FilterParams = { startDate: r.start, endDate: r.end };
  if (q.categories.length) params.categories = q.categories;
  if (q.accounts.length) params.accounts = q.accounts;
  if (q.tags.length) params.tags = q.tags;
  if (q.merchant) params.merchant = q.merchant;
  return params;
}

export const activeFilterCount = (q: AnalyticsQuery): number =>
  [q.categories, q.accounts, q.tags].filter((l) => l.length).length + (q.merchant ? 1 : 0);

/** Chip text: the first name and how many more ("Groceries +1"), or "Any". */
export const capped = (names: string[]): string =>
  names.length === 0 ? 'Any' : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
