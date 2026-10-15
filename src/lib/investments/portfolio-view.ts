import { addDays, utcDay } from './dates';
import { roundCents } from './money';

export type Range = '1M' | '3M' | 'YTD' | '1Y' | '3Y' | 'All';
export const RANGES: Range[] = ['1M', '3M', 'YTD', '1Y', '3Y', 'All'];
export const DEFAULT_RANGE: Range = '3M';
/** Ranges whose start follows from today alone; 'All' starts where the data does. */
export type FixedRange = Exclude<Range, 'All'>;

export const isRange = (v: unknown): v is Range => RANGES.includes(v as Range);

const RANGE_DAYS: Record<Exclude<FixedRange, 'YTD'>, number> = {
  '1M': 30,
  '3M': 91,
  '1Y': 365,
  '3Y': 1095,
};

/** First day of a fixed range ending today (UTC). */
export function rangeStart(range: FixedRange, today: Date): Date {
  if (range === 'YTD') return utcDay(`${today.getUTCFullYear()}-01-01`);
  return addDays(today, -RANGE_DAYS[range]);
}

export type AccountGroup = 'Retirement' | 'Taxable' | 'Crypto';
export const GROUP_ORDER: AccountGroup[] = ['Retirement', 'Taxable', 'Crypto'];

const GROUP_BY_TYPE: Record<string, AccountGroup> = { retirement: 'Retirement', crypto: 'Crypto' };

export const accountGroup = (accountType: string): AccountGroup =>
  GROUP_BY_TYPE[accountType] ?? 'Taxable';

const WRAPPER_BY_SUBTYPE: Record<string, string> = {
  '401k': '401(k)',
  '403b': '403(b)',
  '457b': '457(b)',
  roth: 'Roth IRA',
  'roth 401k': 'Roth 401(k)',
  ira: 'IRA',
  'sep ira': 'SEP IRA',
  'simple ira': 'SIMPLE IRA',
  hsa: 'HSA',
  rrsp: 'RRSP',
  'group rrsp': 'Group RRSP',
  tfsa: 'TFSA',
  brokerage: 'Taxable',
  'cash management': 'Cash mgmt',
  'crypto exchange': 'Crypto',
};

/** The tax wrapper shown next to the institution ("Test Brokerage · 401(k)"). */
export function wrapperLabel(subtype: string | null, accountType: string): string {
  return (subtype && WRAPPER_BY_SUBTYPE[subtype.toLowerCase()]) || accountGroup(accountType);
}

const BUCKET_ALIASES: Record<string, string> = { 'Cash mgmt': 'Taxable' };

/** The "Account" allocation bucket for a wrapper. */
export const allocationBucket = (wrapper: string): string =>
  BUCKET_ALIASES[wrapper] ?? wrapper.replace(/^Group /, '');

export type SeriesChange = { start: number; end: number; delta: number; pct: number | null };

/**
 * Balance change across a series: last point minus first, or null under two points.
 * Not a return (flows aren't removed).
 */
export function seriesChange(points: { value: number }[]): SeriesChange | null {
  if (points.length < 2) return null;
  const start = points[0].value;
  const end = points[points.length - 1].value;
  const delta = roundCents(end - start);
  return { start, end, delta, pct: start === 0 ? null : (delta / start) * 100 };
}
